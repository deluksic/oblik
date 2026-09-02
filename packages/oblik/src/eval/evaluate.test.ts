import { describe, expect, test } from "vitest";

import { analyze } from "../source/analyze";
import {
  along,
  circle,
  fillet,
  leftOf,
  paint,
  point,
  pointOnCircle,
  pointOnSegment,
  profile,
  region,
  roundOffset,
  segment,
  slider,
  style,
} from "./constructors";
import { emit, evaluate, tryEvaluate } from "./evaluate";
import { paintsFromTrace, paintStrokesFromTrace } from "./paint";
import { defineScene } from "./scene";
import { siteOf } from "./site";

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

  test("profile is traced; along is not", () => {
    const scene = defineScene({
      kind: "euclid2",
      title: "t",
      build() {
        const O = point(0, 0, "o");
        const c = circle(O, 2, "c");
        const A = pointOnCircle(c, 1, 0, "a");
        const B = pointOnCircle(c, 0, 1, "b");
        const ch = segment(A, B, "ch");
        return profile([A, ch, B, along(c, -1)], "pr");
      },
    });
    const { trace } = evaluate(scene);
    expect(trace.map((n) => n.kind)).toEqual([
      "point",
      "circle",
      "gliderCircle",
      "gliderCircle",
      "segment",
      "profile",
    ]);
    const p = trace.find((n) => n.id === "pr");
    expect(p?.value.kind).toBe("profile");
    expect(p?.value.kind === "profile" ? p.value.outer : []).toHaveLength(
      p?.value.kind === "profile" ? 2 : 0,
    );
  });

  test("profile holes are walks, not tape nodes", () => {
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
        return profile(
          [A, ab, B, bc, C, cd, D, da],
          { holes: [[h0, hab, h1, hbc, h2, hcd, h3, hda]] },
          "pr",
        );
      },
    });
    const { trace } = evaluate(scene);
    expect(trace.filter((n) => n.kind === "profile")).toHaveLength(1);
    const p = trace.find((n) => n.id === "pr");
    expect(p?.value.kind === "profile" ? p.value.holes : []).toHaveLength(1);
    expect(p?.value.kind === "profile" ? p.value.outer : []).toHaveLength(4);
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
        return profile([fillet(A, 0.3), ab, B, bc, C, ca], "pr");
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
      "profile",
    ]);
    const p = trace.find((n) => n.id === "pr");
    expect(p?.kind).toBe("profile");
    expect(p?.value.kind === "profile" ? p.value.outer : []).toHaveLength(
      p?.value.kind === "profile" ? 4 : 0,
    );
    expect(
      p?.value.kind === "profile" ? p.value.outer.filter((e) => e.carrier.kind === "circle") : [],
    ).toHaveLength(p?.value.kind === "profile" ? 1 : 0);
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
        const face = profile([A, ch, B, along(c, -1)], "pr");
        return roundOffset(face, -0.12, "off");
      },
    });
    const { trace } = evaluate(scene, {
      annotations: analyze(
        `const face = profile([A, ch, B, along(c, -1)], "pr");\nroundOffset(face, -0.12, "off");\n`,
      ),
    });
    const off = trace.find((n) => n.id === "off");
    expect(off?.kind).toBe("region");
    expect(off?.editable).toBe(true);
    const stock = off?.value.kind === "region" ? off.value.stock : null;
    expect(stock?.kind).toBe("offset");
    expect(stock?.kind === "offset" ? stock.d : 0).toBeCloseTo(-0.12);
    const drafted = evaluate(scene, {
      annotations: analyze(`roundOffset(face, -0.12, "off");\n`),
      draft: new Map([["off", [-0.5]]]),
    }).trace.find((n) => n.id === "off");
    expect(drafted?.kind).toBe("region");
    expect(drafted?.value.kind === "region" ? drafted.value.stock.kind : null).toBe("offset");
    expect(
      drafted?.value.kind === "region" && drafted.value.stock.kind === "offset"
        ? drafted.value.stock.d
        : 0,
    ).toBeCloseTo(-0.5);
  });

  test("region is traced; leftOf is not", () => {
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
        const stock = profile([A, ab, B, bc, C, cd, D, da], "pr");
        const split = segment(point(1, -1, "s0"), point(1, 3, "s1"), "sp");
        const left = region(stock, { keep: leftOf(split) }, "reg");
        return { stock, left };
      },
    });
    const { trace } = evaluate(scene);
    expect(trace.filter((n) => n.kind === "region")).toHaveLength(1);
    expect(trace.find((n) => n.id === "reg")?.kind).toBe("region");
    expect(trace.find((n) => n.id === "pr")?.kind).toBe("profile");
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
        const stock = profile([A, ab, B, bc, C, cd, D, da], "pr");
        const split = segment(point(Number.NaN, 0, "s0"), point(1, 3, "s1"), "sp");
        region(stock, { keep: leftOf(split) }, "reg");
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
