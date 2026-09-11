import { describe, expect, test } from "vitest";

import { isCsg2, isFiniteOperand, offsetOfCsg, operandSdf } from "../geom/csg2";
import { walkEdges } from "../geom/region";
import type { CsgOperand } from "../geom/types";
import { analyze } from "../source/analyze";
import {
  along,
  circle,
  fillet,
  image,
  leftOf,
  paint,
  point,
  pointOnCircle,
  pointOnSegment,
  intersect,
  csg2,
  diff,
  pick,
  polarRepeat,
  region,
  roundOffset,
  segment,
  slider,
  style,
  union,
} from "./constructors";
import { emit, evaluate, tryEvaluate } from "./evaluate";
import type { ImageOpts } from "./image";
import { paintsFromTrace, paintStrokesFromTrace } from "./paint";
import { defineScene } from "./scene";
import { siteOf } from "./site";
import { EMPTY_STACK } from "./stack";

function plate() {
  point(1, 2, "h");
  point(3, 4);
}

describe("evaluate", () => {
  test("segment is one trace, not endpoint points", () => {
    const scene = defineScene({
      kind: "euclid2",
      title: "t",
      build() {
        const a = point(0, 0, "a");
        const b = point(1, 0, "b");
        return segment(a, b, "s");
      },
    });
    const annotations = analyze(
      `const a = point(0, 0, "a");\nconst b = point(1, 0, "b");\nsegment(a, b, "s");\n`,
    );
    const { trace } = evaluate(scene, { annotations });
    expect(trace.map((n) => n.kind)).toEqual(["point", "point", "segment"]);
    expect(trace.filter((n) => n.kind === "point")).toHaveLength(2);
  });

  test("draft overrides circle radius", () => {
    const scene = defineScene({
      kind: "euclid2",
      title: "t",
      build() {
        const A = point(0, 0, "a");
        return circle(A, 2.5, "c");
      },
    });
    const annotations = analyze(`const A = point(0, 0, "a");\ncircle(A, 2.5, "c");\n`);
    const { trace } = evaluate(scene, {
      annotations,
      draft: new Map([["c", [4]]]),
    });
    const c = trace.find((n) => n.id === "c");
    expect(c?.value.kind).toBe("circle");
    expect(c?.value.kind === "circle" ? c.value.radius : undefined).toBe(
      c?.value.kind === "circle" ? 4 : undefined,
    );
  });

  test("draft overrides a segment glider parameter", () => {
    const scene = defineScene({
      kind: "euclid2",
      title: "t",
      build() {
        const a = point(0, 0, "a");
        const b = point(4, 0, "b");
        const span = segment(a, b, "s");
        return pointOnSegment(span, 0.25, "g");
      },
    });
    const annotations = analyze(
      `const a = point(0, 0, "a");\nconst b = point(4, 0, "b");\nconst span = segment(a, b, "s");\npointOnSegment(span, 0.25, "g");\n`,
    );
    const { trace } = evaluate(scene, {
      annotations,
      draft: new Map([["g", [0.75]]]),
    });
    const g = trace.find((n) => n.id === "g");
    expect(g?.value.kind).toBe("gliderSegment");
    expect(g?.value.kind === "gliderSegment" ? g.value.t : undefined).toBe(
      g?.value.kind === "gliderSegment" ? 0.75 : undefined,
    );
    expect(g?.value.kind === "gliderSegment" ? g.value.x : undefined).toBe(
      g?.value.kind === "gliderSegment" ? 3 : undefined,
    );
  });

  test("nested evaluate does not leak tape; emit re-emits the same id", () => {
    const inner = defineScene({
      kind: "euclid2",
      title: "inner",
      build() {
        return point(1, 2, "p");
      },
    });
    const outer = defineScene({
      kind: "euclid2",
      title: "outer",
      build() {
        emit(evaluate(inner).value);
      },
    });
    const { trace } = evaluate(outer);
    expect(trace).toHaveLength(1);
    expect(trace[0]?.id).toBe("p");
  });

  test("circle carries $site dof on the function", () => {
    expect(siteOf(circle)?.dof).toEqual([1]);
    expect(siteOf(point)?.dof).toEqual([0, 1]);
    expect(siteOf(segment)?.dof).toEqual([]);
    expect(siteOf(slider)?.dof).toEqual([0]);
  });

  test("a loop reuses one constructor id across occ", () => {
    const scene = defineScene({
      kind: "euclid2",
      title: "t",
      build() {
        const o = point(0, 0, "o");
        for (let i = 0; i < 5; i++) {
          circle({ x: o.x + i, y: 0 }, 1, "ring");
        }
      },
    });
    const annotations = analyze(
      `const o = point(0, 0, "o");\nfor (let i = 0; i < 5; i++) {\n  circle({ x: o.x + i, y: 0 }, 1, "ring");\n}\n`,
    );
    const { trace } = evaluate(scene, { annotations });
    const rings = trace.filter((n) => n.id === "ring");
    expect(rings).toHaveLength(5);
    expect(rings.map((n) => n.occ)).toEqual([0, 1, 2, 3, 4]);
    expect(rings.every((n) => n.editable)).toBe(true);
    const drafted = evaluate(scene, {
      annotations,
      draft: new Map([["ring", [1.5]]]),
    }).trace.filter((n) => n.id === "ring");
    expect(drafted.every((n) => n.value.kind === "circle" && n.value.radius === 1.5)).toBe(true);
  });

  test("slider traces a HUD number", () => {
    const scene = defineScene({
      kind: "euclid2",
      title: "t",
      build() {
        const reach = slider(1.8, { min: 0, max: 4, step: 0.05 }, "o_sl");
        return reach;
      },
    });
    const annotations = analyze(
      `const reach = slider(1.8, { min: 0, max: 4, step: 0.05 }, "o_sl");\n`,
    );
    const { trace, value } = evaluate(scene, { annotations });
    expect(value).toBe(1.8);
    expect(trace).toHaveLength(1);
    expect(trace[0]?.kind).toBe("slider");
    expect(trace[0]?.bind).toBe("reach");
    expect(trace[0]?.value.kind === "slider" ? trace[0].value.n : undefined).toBe(
      trace[0]?.value.kind === "slider" ? 1.8 : undefined,
    );
  });

  test("a helper with ids joins the current tape; without ids it does not", () => {
    const scene = defineScene({
      kind: "euclid2",
      title: "t",
      build() {
        plate();
      },
    });
    const helper = `const A = point(1, 2, "h");\n`;
    const { trace } = evaluate(scene, {
      annotations: analyze(helper, "apps/demo/src/layout/plate.ts"),
      module: "apps/demo/src/scenes/plate.ts",
    });
    expect(trace.map((n) => n.id)).toEqual(["h"]);
    expect(trace[0]?.module).toBe("apps/demo/src/layout/plate.ts");
  });

  test("region is traced; along is not", () => {
    const scene = defineScene({
      kind: "euclid2",
      title: "t",
      build() {
        const O = point(0, 0, "o");
        const c = circle(O, 2, "c");
        const A = pointOnCircle(c, 1, 0, "a");
        const B = pointOnCircle(c, 0, 1, "b");
        const ch = segment(A, B, "ch");
        return region([A, ch, B, along(c, -1)], [], "pr");
      },
    });
    const { trace } = evaluate(scene);
    expect(trace.map((n) => n.kind)).toEqual([
      "point",
      "circle",
      "gliderCircle",
      "gliderCircle",
      "segment",
      "region",
    ]);
    const p = trace.find((n) => n.id === "pr");
    expect(p?.value.kind).toBe("region");
    expect(p?.value.kind === "region" ? p.value.outer : []).toHaveLength(
      p?.value.kind === "region" ? 2 : 0,
    );
  });

  test("region holes are walks, not tape nodes", () => {
    const scene = defineScene({
      kind: "euclid2",
      title: "t",
      build() {
        const A = point(0, 0, "a");
        const B = point(2, 0, "b");
        const C = point(2, 2, "c");
        const D = point(0, 2, "d");
        const ab = segment(A, B, "ab");
        const bc = segment(B, C, "bc");
        const cd = segment(C, D, "cd");
        const da = segment(D, A, "da");
        const h0 = point(0.5, 0.5, "h0");
        const h1 = point(1.5, 0.5, "h1");
        const h2 = point(1.5, 1.5, "h2");
        const h3 = point(0.5, 1.5, "h3");
        const hab = segment(h0, h1, "hab");
        const hbc = segment(h1, h2, "hbc");
        const hcd = segment(h2, h3, "hcd");
        const hda = segment(h3, h0, "hda");
        return region([A, ab, B, bc, C, cd, D, da], [[h0, hab, h1, hbc, h2, hcd, h3, hda]], "pr");
      },
    });
    const { trace } = evaluate(scene);
    expect(trace.filter((n) => n.kind === "region")).toHaveLength(1);
    const p = trace.find((n) => n.id === "pr");
    expect(p?.value.kind === "region" ? p.value.holes : []).toHaveLength(1);
    expect(p?.value.kind === "region" ? p.value.outer : []).toHaveLength(4);
  });

  test("fillet is not a tape node", () => {
    const scene = defineScene({
      kind: "euclid2",
      title: "t",
      build() {
        const A = point(0, 0, "a");
        const B = point(2, 0, "b");
        const C = point(0, 2, "c");
        const ab = segment(A, B, "ab");
        const bc = segment(B, C, "bc");
        const ca = segment(C, A, "ca");
        return region([fillet(A, 0.3), ab, B, bc, C, ca], [], "pr");
      },
    });
    const { trace } = evaluate(scene);
    expect(trace.map((n) => n.kind)).toEqual([
      "point",
      "point",
      "point",
      "segment",
      "segment",
      "segment",
      "region",
    ]);
    const p = trace.find((n) => n.id === "pr");
    expect(p?.kind).toBe("region");
    expect(p?.value.kind === "region" ? walkEdges(p.value.outer) : []).toHaveLength(
      p?.value.kind === "region" ? 4 : 0,
    );
    expect(
      p?.value.kind === "region"
        ? walkEdges(p.value.outer).filter((e) => e.carrier.kind === "circle")
        : [],
    ).toHaveLength(p?.value.kind === "region" ? 1 : 0);
  });

  test("roundOffset is traced with dof on the distance", () => {
    expect(siteOf(roundOffset)?.dof).toEqual([1]);
    const scene = defineScene({
      kind: "euclid2",
      title: "t",
      build() {
        const O = point(0, 0, "o");
        const c = circle(O, 2, "c");
        const A = pointOnCircle(c, 1, 0, "a");
        const B = pointOnCircle(c, 0, 1, "b");
        const ch = segment(A, B, "ch");
        const face = region([A, ch, B, along(c, -1)], [], "pr");
        return roundOffset(face, -0.12, "off");
      },
    });
    const { trace } = evaluate(scene, {
      annotations: analyze(
        `const face = region([A, ch, B, along(c, -1)], [], "pr");\nroundOffset(face, -0.12, "off");\n`,
      ),
    });
    const off = trace.find((n) => n.id === "off");
    expect(off?.kind).toBe("csg2");
    expect(off?.editable).toBe(true);
    const stock = off && isCsg2(off.value) ? offsetOfCsg(off.value) : undefined;
    expect(stock?.kind).toBe("offset");
    expect(stock?.kind === "offset" ? stock.d : 0).toBeCloseTo(-0.12);
    const drafted = evaluate(scene, {
      annotations: analyze(`roundOffset(face, -0.12, "off");\n`),
      draft: new Map([["off", [-0.5]]]),
    }).trace.find((n) => n.id === "off");
    expect(drafted?.kind).toBe("csg2");
    const draftedStock = drafted && isCsg2(drafted.value) ? offsetOfCsg(drafted.value) : undefined;
    expect(draftedStock?.kind).toBe("offset");
    expect(draftedStock?.kind === "offset" ? draftedStock.d : 0).toBeCloseTo(-0.5);
  });

  test("region is traced; leftOf and intersect are not", () => {
    const scene = defineScene({
      kind: "euclid2",
      title: "t",
      build() {
        const A = point(0, 0, "a");
        const B = point(2, 0, "b");
        const C = point(2, 2, "c");
        const D = point(0, 2, "d");
        const ab = segment(A, B, "ab");
        const bc = segment(B, C, "bc");
        const cd = segment(C, D, "cd");
        const da = segment(D, A, "da");
        const stock = region([A, ab, B, bc, C, cd, D, da], [], "pr");
        const split = segment(point(1, -1, "s0"), point(1, 3, "s1"), "sp");
        const left = csg2(intersect([stock, leftOf(split)]), "reg");
        return { stock, left };
      },
    });
    const { trace } = evaluate(scene);
    expect(trace.filter((n) => n.kind === "csg2")).toHaveLength(1);
    expect(trace.find((n) => n.id === "reg")?.kind).toBe("csg2");
    expect(trace.find((n) => n.id === "pr")?.kind).toBe("region");
  });

  test("diff is not traced; csg2 is", () => {
    const scene = defineScene({
      kind: "euclid2",
      title: "t",
      build() {
        const a = point(0, 0, "a");
        const b = point(2, 0, "b");
        const c = point(2, 2, "c");
        const d = point(0, 2, "d");
        const stock = region(
          [a, segment(a, b), b, segment(b, c), c, segment(c, d), d, segment(d, a)],
          [],
          "pr",
        );
        const hole = circle(point(1, 1, "h"), 0.3);
        const face = csg2(diff(stock, [hole]), "face");
        return { stock, face };
      },
    });
    const { trace } = evaluate(scene);
    expect(trace.filter((n) => n.kind === "csg2")).toHaveLength(1);
    expect(trace.find((n) => n.id === "face")?.kind).toBe("csg2");
  });

  test("NaN keep operand drops the derived region from the tape", () => {
    const scene = defineScene({
      kind: "euclid2",
      title: "t",
      build() {
        const A = point(0, 0, "a");
        const B = point(2, 0, "b");
        const C = point(2, 2, "c");
        const D = point(0, 2, "d");
        const ab = segment(A, B, "ab");
        const bc = segment(B, C, "bc");
        const cd = segment(C, D, "cd");
        const da = segment(D, A, "da");
        const stock = region([A, ab, B, bc, C, cd, D, da], [], "pr");
        const split = segment(point(Number.NaN, 0, "s0"), point(1, 3, "s1"), "sp");
        csg2(intersect([stock, leftOf(split)]), "reg");
        return stock;
      },
    });
    const { trace } = evaluate(scene);
    expect(trace.some((n) => n.id === "pr")).toBe(true);
    expect(trace.some((n) => n.id === "reg")).toBe(false);
  });
});

describe("style and paint", () => {
  test("paint accepts a spec object without style()", () => {
    const scene = defineScene({
      kind: "figure",
      title: "t",
      build() {
        const A = point(0, 0, "a");
        paint(A, { stroke: "#1c1917", width: 1.2 }, "p");
      },
    });
    const { trace } = evaluate(scene);
    expect(trace.map((n) => n.kind)).toEqual(["point", "paint"]);
    const p = trace.find((n) => n.kind === "paint");
    expect(p?.value.kind).toBe("paint");
    expect(p?.value.kind === "paint" ? p.value.targets : undefined).toEqual(
      p?.value.kind === "paint" ? [{ id: "a", occ: 0 }] : undefined,
    );
    expect(p?.value.kind === "paint" ? p.value.style.stroke : undefined).toBe(
      p?.value.kind === "paint" ? "#1c1917" : undefined,
    );
  });

  test("style() inside build is a tape node paint can reuse", () => {
    const scene = defineScene({
      kind: "figure",
      title: "t",
      build() {
        const A = point(0, 0, "a");
        const B = point(1, 0, "b");
        const hole = style({ stroke: "#1c1917", width: 1.2 }, "s");
        paint(A, hole, "p0");
        paint(B, hole, "p1");
      },
    });
    const { trace } = evaluate(scene);
    expect(trace.map((n) => n.kind)).toEqual(["point", "point", "style", "paint", "paint"]);
    expect(trace.filter((n) => n.kind === "paint")).toHaveLength(2);
  });

  test("style() without eval ctx is an untraced value", () => {
    const ink = style({ stroke: "#111", width: 1.35 });
    expect(ink).toEqual({ kind: "style", stroke: "#111", width: 1.35 });
    expect(evaluate(defineScene({ kind: "figure", title: "t", build() {} })).trace).toEqual([]);
  });

  test("paint walks a bag; a second paint on the same target is another stroke", () => {
    const scene = defineScene({
      kind: "figure",
      title: "t",
      build() {
        const A = point(0, 0, "a");
        const B = point(1, 0, "b");
        const ink = style({ stroke: "#111", width: 1 }, "s0");
        const heavy = style({ stroke: "#111", width: 2.2 }, "s1");
        paint({ A, B }, ink, "p0");
        paint(B, heavy, "p1");
      },
    });
    const { trace } = evaluate(scene);
    const map = paintsFromTrace(trace);
    expect(map.get("a:0")?.width).toBe(1);
    expect(map.get("b:0")?.width).toBe(2.2);
    const strokes = paintStrokesFromTrace(trace);
    expect(strokes.filter((s) => s.geom.id === "b")).toHaveLength(2);
    const first = trace.find((n) => n.id === "p0");
    expect(first?.value.kind === "paint" ? first.value.targets : []).toHaveLength(
      first?.value.kind === "paint" ? 2 : 0,
    );
  });
});

describe("captureStack", () => {
  const scene = defineScene({
    kind: "euclid2",
    title: "t",
    build() {
      point(0, 0, "a");
      return slider(0.5, { min: 0, max: 1 }, "s");
    },
  });

  test("default eval captures constructor stacks", () => {
    const { trace } = evaluate(scene);
    const explicit = evaluate(scene, { captureStack: true }).trace;
    expect(trace.every((n) => n.stack.length > 0)).toBe(true);
    // Full V8 walk — not a thinned helper-only slice.
    expect(trace[0]!.stack.length).toBeGreaterThan(3);
    expect(explicit.map((n) => n.stack.length)).toEqual(trace.map((n) => n.stack.length));
  });

  test("captureStack: false skips capture and stores the empty stack", () => {
    const { trace } = evaluate(scene, { captureStack: false });
    expect(trace.map((n) => n.stack)).toEqual([EMPTY_STACK, EMPTY_STACK]);
    expect(trace.every((n) => n.stack === EMPTY_STACK)).toBe(true);
  });
});

describe("tryEvaluate", () => {
  test("a thrown build becomes an error instead of a throw", () => {
    const scene = defineScene({
      kind: "euclid2",
      title: "t",
      build() {
        throw new ReferenceError("left is not defined");
      },
    });
    const out = tryEvaluate(scene);
    expect(out.error).toBe("left is not defined");
    expect(out.trace).toEqual([]);
  });
});

/** One cell of a ring, generated the way a scene's layout would. */
function cell(): { x: number; y: number }[] {
  return [
    { x: 1.8, y: -0.3 },
    { x: 2.2, y: -0.3 },
    { x: 2.2, y: 0.3 },
    { x: 1.8, y: 0.3 },
  ];
}

describe("polarRepeat", () => {
  test("a point chain becomes a region and folds into a repeat", () => {
    const rep = polarRepeat(cell(), 12, { x: 0, y: 0 }, 0.4);
    expect(rep.kind).toBe("polarRepeat");
    expect(rep.count).toBe(12);
    expect(rep.of.kind).toBe("region");
    // Authored unrotated: the cell's own distance is the repeat's on its centre.
    expect(operandSdf(rep, { x: 2, y: 0 })).toBeLessThan(0);
    expect(operandSdf(rep, { x: -2, y: 0 })).toBeLessThan(0);
  });

  test("a walk with carriers passes straight through", () => {
    const O = { x: 0, y: 0 };
    const A = { x: 2, y: 0 };
    const B = { x: 0, y: 2 };
    const oa = segment(O, A);
    const ab = segment(A, B);
    const bo = segment(B, O);
    const rep = polarRepeat([O, oa, A, ab, B, bo], 4, { x: 0, y: 0 }, 0);
    expect(rep.of.kind).toBe("region");
    expect(isFiniteOperand(rep)).toBe(true);
  });

  test("it is an operand, not a tape node: `csg2` is what draws it", () => {
    const scene = defineScene({
      kind: "euclid2",
      title: "t",
      build() {
        const face = csg2(diff(polarRepeat(cell(), 12, { x: 0, y: 0 }, 0), []), "face");
        return face;
      },
    });
    const { trace } = evaluate(scene, {});
    // One node: the `csg2`. The repeat inside it is a value, so it is neither
    // drawn nor inspectable on its own — the operand-helper convention (`diff`,
    // `leftOf`) the stamping and the panes both rely on.
    expect(trace).toHaveLength(1);
    expect(trace[0]!.kind).toBe("csg2");
    expect(trace[0]!.id).toBe("face");
  });

  test("a repeat with a bad cell reads as empty, not as a broken ring", () => {
    expect(isFiniteOperand(polarRepeat([], 12, { x: 0, y: 0 }, 0))).toBe(false);
    expect(isFiniteOperand(polarRepeat(cell(), Number.NaN, { x: 0, y: 0 }, 0))).toBe(false);
    expect(isFiniteOperand(polarRepeat(cell(), 12, { x: Number.NaN, y: 0 }, 0))).toBe(false);
  });
});

// Scene source is printed text: the GUI inserts `union([a, b])` and the module
// loads without a typecheck, so a wrong argument arrives as a value, not as a
// compile error. These hand the gate what such a call would.
const authoredOperand = (v: object): CsgOperand => v as CsgOperand;
const authoredList = (v: object): readonly CsgOperand[] => v as readonly CsgOperand[];

describe("the operand gate", () => {
  test("a wrong element is NaN geometry, not a throw", () => {
    const face = union([circle(point(0, 0), 1), authoredOperand({ x: 0, y: 1 })]);
    expect(isFiniteOperand(face)).toBe(false);
  });

  test("a non-list argument is NaN geometry, not a throw", () => {
    expect(isFiniteOperand(union(authoredList({})))).toBe(false);
    expect(isFiniteOperand(intersect(authoredList({})))).toBe(false);
    expect(isFiniteOperand(diff(circle(point(0, 0), 1), authoredList({})))).toBe(false);
  });

  test("a wrong pick probe is NaN geometry, not a throw", () => {
    expect(isFiniteOperand(pick(authoredOperand({ x: 0, y: 0 }), { x: 1, y: 1 }))).toBe(false);
  });
});

function imageScene(body: () => void) {
  return defineScene({
    kind: "euclid2",
    title: "t",
    build: body,
  });
}

describe("image nodes", () => {
  test("records one node with the rect it was authored with", () => {
    const { trace } = evaluate(
      imageScene(() => {
        image(
          "/assets/gear-9f3a2c11.png",
          { x: 10, y: 20, w: 40, h: 20, rot: 90, flip: 1, fade: 0.25 },
          "o_img",
        );
      }),
    );
    expect(trace.map((n) => n.kind)).toEqual(["image"]);
    const node = trace[0]!;
    expect(node.id).toBe("o_img");
    expect(node.occ).toBe(0);
    expect(node.value).toEqual({
      kind: "image",
      src: "/assets/gear-9f3a2c11.png",
      x: 10,
      y: 20,
      w: 40,
      h: 20,
      rot: 90,
      flip: 1,
      fade: 0.25,
    });
  });

  test("the look props default to their no-op values", () => {
    const { trace } = evaluate(
      imageScene(() => {
        image("/a.png", { x: 1, y: 2, w: 3, h: 4 }, "o_img");
      }),
    );
    expect(trace[0]?.value).toMatchObject({ rot: 0, flip: 0, fade: 0 });
  });

  test("an occurrence counts like any other node", () => {
    const { trace } = evaluate(
      imageScene(() => {
        for (let i = 0; i < 2; i++) image("/a.png", { x: 0, y: 0, w: 10, h: 10 }, "o_img");
      }),
    );
    expect(trace.map((n) => n.occ)).toEqual([0, 1]);
  });

  /**
   * The props live in an options object, where the positional literal patcher
   * cannot reach them, so a reference has no draft path: a drag that writes a
   * draft row for one changes nothing. The inspector's patch endpoint is the
   * writer instead (`source/image-edit.ts`).
   */
  test("a draft row does not move a reference", () => {
    const draft = new Map([["o_img", [1, 2, 3, 4, 270, 1, 0.9]]]);
    const { trace } = evaluate(
      imageScene(() => {
        image("/a.png", { x: 0, y: 0, w: 10, h: 10 }, "o_img");
      }),
      { draft },
    );
    expect(trace[0]?.value).toMatchObject({ x: 0, y: 0, w: 10, h: 10, rot: 0, fade: 0 });
  });

  test("a missing side or an empty source is evaluated but never recorded", () => {
    const { trace } = evaluate(
      imageScene(() => {
        // JavaScript callers are not typechecked: the guard is what stops it.
        image("/a.png", { x: 0, y: 0, w: 10 } as ImageOpts, "o_missing");
        image("", { x: 0, y: 0, w: 10, h: 10 }, "o_sourceless");
        image("/a.png", { x: 0, y: 0, w: 10, h: 10 }, "o_good");
      }),
    );
    expect(trace.map((n) => n.id)).toEqual(["o_good"]);
  });
});
