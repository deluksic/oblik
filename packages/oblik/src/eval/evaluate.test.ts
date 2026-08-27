import { describe, expect, test } from "vitest";

import { siteOf } from "./site";
import { along, circle, fillet, paint, point, pointOnCircle, pointOnSegment, profile, roundOffset, segment, slider, style } from "./constructors";
import { paintsFromTrace } from "./paint";
import { defineScene } from "./scene";
import { emit, evaluate, tryEvaluate } from "./evaluate";
import { analyze } from "../source/analyze";

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
    if (c?.value.kind === "circle") expect(c.value.radius).toBe(4);
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
    if (g?.value.kind === "gliderSegment") {
      expect(g.value.t).toBe(0.75);
      expect(g.value.x).toBe(3);
    }
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
    const drafted = evaluate(scene, { annotations, draft: new Map([["ring", [1.5]]]) }).trace.filter(
      (n) => n.id === "ring",
    );
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
    const annotations = analyze(`const reach = slider(1.8, { min: 0, max: 4, step: 0.05 }, "o_sl");\n`);
    const { trace, value } = evaluate(scene, { annotations });
    expect(value).toBe(1.8);
    expect(trace).toHaveLength(1);
    expect(trace[0]?.kind).toBe("slider");
    expect(trace[0]?.bind).toBe("reach");
    if (trace[0]?.value.kind === "slider") {
      expect(trace[0].value.n).toBe(1.8);
    }
  });

  test("a helper with ids joins the current tape; without ids it does not", () => {
    function plate() {
      point(1, 2, "h");
      point(3, 4);
    }
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
    expect(trace.map((n) => n.kind)).toEqual(["point", "circle", "gliderCircle", "gliderCircle", "segment", "profile"]);
    const p = trace.find((n) => n.id === "pr");
    expect(p?.value.kind).toBe("profile");
    if (p?.value.kind === "profile") expect(p.value.outer).toHaveLength(2);
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
    expect(trace.map((n) => n.kind)).toEqual(["point", "point", "point", "segment", "segment", "segment", "profile"]);
    const p = trace.find((n) => n.id === "pr");
    expect(p?.kind).toBe("profile");
    if (p?.value.kind === "profile") {
      expect(p.value.outer).toHaveLength(4);
      expect(p.value.outer.filter((e) => e.carrier.kind === "circle")).toHaveLength(1);
    }
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
    expect(off?.kind).toBe("profile");
    expect(off?.editable).toBe(true);
    if (off?.value.kind === "profile") expect(off.value.outer).toHaveLength(2);
    const drafted = evaluate(scene, {
      annotations: analyze(`roundOffset(face, -0.12, "off");\n`),
      draft: new Map([["off", [-0.5]]]),
    }).trace.find((n) => n.id === "off");
    expect(drafted).toBeUndefined();
  });
});

describe("style and paint", () => {
  test("are tape nodes inside evaluate", () => {
    const scene = defineScene({
      kind: "figure",
      title: "t",
      build() {
        const A = point(0, 0, "a");
        const ink = style({ stroke: "#1c1917", width: 1.2 }, "s");
        paint(A, ink, "p");
      },
    });
    const { trace } = evaluate(scene);
    expect(trace.map((n) => n.kind)).toEqual(["point", "style", "paint"]);
    const p = trace.find((n) => n.kind === "paint");
    expect(p?.value.kind).toBe("paint");
    if (p?.value.kind === "paint") {
      expect(p.value.targets).toEqual([{ id: "a", occ: 0 }]);
      expect(p.value.style.stroke).toBe("#1c1917");
    }
  });

  test("style() without eval ctx is an untraced value", () => {
    const ink = style({ stroke: "#111", width: 1.35 });
    expect(ink).toEqual({ kind: "style", stroke: "#111", width: 1.35 });
    expect(evaluate(defineScene({ kind: "figure", title: "t", build() {} })).trace).toEqual([]);
  });

  test("paint walks a bag; later paint of the same target wins", () => {
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
    const first = trace.find((n) => n.id === "p0");
    if (first?.value.kind === "paint") expect(first.value.targets).toHaveLength(2);
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
