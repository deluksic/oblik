import { describe, expect, test } from "vitest";

import type { TraceNode } from "../eval/context";
import { gliderOnTraceNode, resolvePlacePoint } from "./place";

function node(
  partial: Pick<TraceNode, "id" | "value"> & Partial<TraceNode>,
): TraceNode {
  return {
    occ: 0,
    editable: false,
    stack: [],
    kind: partial.value.kind,
    ...partial,
  };
}

const A = node({
  id: "o_a",
  bind: "A",
  editable: true,
  value: { kind: "point", x: 0, y: 0 },
});

const ground = node({
  id: "o_g",
  bind: "ground",
  value: { kind: "line", origin: { x: 0, y: 0 }, direction: { x: 1, y: 0 } },
});

const wall = node({
  id: "o_w",
  bind: "wall",
  value: { kind: "line", origin: { x: 2, y: 0 }, direction: { x: 0, y: 1 } },
});

const shelf = node({
  id: "o_par",
  bind: "shelf",
  value: {
    kind: "parallelLine",
    line: { kind: "line", origin: { x: 0, y: 1.8 }, direction: { x: 1, y: 0 } },
    distance: 1.8,
  },
});

const reach = node({
  id: "o_r",
  bind: "reach",
  value: { kind: "circle", center: { x: 0, y: 0 }, radius: 2 },
});

describe("resolvePlacePoint", () => {
  test("falls back to a free point", () => {
    const p = resolvePlacePoint([A], { x: 4, y: 1 }, 0.3);
    expect(p).toEqual({ kind: "free", at: { x: 4, y: 1 } });
  });

  test("snaps to a named bound point", () => {
    const p = resolvePlacePoint([A, ground], { x: 0.1, y: 0 }, 0.3);
    expect(p).toMatchObject({ kind: "ref", bind: "A", id: "o_a" });
  });

  test("snaps to a line-line crossing", () => {
    const p = resolvePlacePoint([ground, wall], { x: 2.05, y: 0.02 }, 0.3);
    expect(p.kind).toBe("lineIntersection");
    if (p.kind !== "lineIntersection") return;
    expect(p.a).toBe("ground");
    expect(p.b).toBe("wall");
    expect(p.at.x).toBeCloseTo(2);
    expect(p.at.y).toBeCloseTo(0);
  });

  test("skips parallel line-likes", () => {
    const p = resolvePlacePoint([ground, shelf], { x: 1, y: 0.9 }, 0.3);
    expect(p.kind).toBe("free");
  });

  test("freezes circle-line k from the nearer root", () => {
    const plus = resolvePlacePoint([reach, ground], { x: 2, y: 0 }, 0.3);
    expect(plus).toMatchObject({
      kind: "circleLineIntersection",
      circle: "reach",
      line: "ground",
      k: 1,
    });
    const minus = resolvePlacePoint([reach, ground], { x: -2, y: 0 }, 0.3);
    expect(minus).toMatchObject({
      kind: "circleLineIntersection",
      circle: "reach",
      line: "ground",
      k: -1,
    });
  });

  test("circle-line works with a parallel carrier", () => {
    const p = resolvePlacePoint([reach, shelf], { x: 0.87, y: 1.8 }, 0.4);
    expect(p.kind).toBe("circleLineIntersection");
    if (p.kind !== "circleLineIntersection") return;
    expect(p.circle).toBe("reach");
    expect(p.line).toBe("shelf");
    expect(p.at.y).toBeCloseTo(1.8);
  });

  test("prefers a named point sitting on a crossing", () => {
    const P = node({
      id: "o_p",
      bind: "P",
      value: { kind: "point", x: 2, y: 0 },
    });
    const p = resolvePlacePoint([ground, wall, P], { x: 2, y: 0 }, 0.3);
    expect(p).toMatchObject({ kind: "ref", bind: "P" });
  });

  test("reuses a named point in range even if the crossing is closer", () => {
    const P = node({
      id: "o_p",
      bind: "P",
      value: { kind: "point", x: 2.12, y: 0 },
    });
    const p = resolvePlacePoint([ground, wall, P], { x: 2, y: 0 }, 0.3);
    expect(p).toMatchObject({ kind: "ref", bind: "P" });
  });

  test("picks a crossing when the named point is out of range", () => {
    const p = resolvePlacePoint([A, ground, wall], { x: 2, y: 0 }, 0.3);
    expect(p.kind).toBe("lineIntersection");
  });

  test("freezes circle-circle k from the nearer root", () => {
    const other = node({
      id: "o_c2",
      bind: "lamp",
      value: { kind: "circle", center: { x: 2, y: 0 }, radius: 2 },
    });
    const plus = resolvePlacePoint([reach, other], { x: 1, y: Math.sqrt(3) }, 0.3);
    expect(plus).toMatchObject({
      kind: "circleCircleIntersection",
      a: "reach",
      b: "lamp",
      k: 1,
    });
    const minus = resolvePlacePoint([reach, other], { x: 1, y: -Math.sqrt(3) }, 0.3);
    expect(minus).toMatchObject({
      kind: "circleCircleIntersection",
      a: "reach",
      b: "lamp",
      k: -1,
    });
  });

  test("skips disjoint circles", () => {
    const far = node({
      id: "o_far",
      bind: "far",
      value: { kind: "circle", center: { x: 10, y: 0 }, radius: 1 },
    });
    const p = resolvePlacePoint([reach, far], { x: 5, y: 0 }, 0.3);
    expect(p.kind).toBe("free");
  });

  test("snaps to a glider on a line", () => {
    const p = resolvePlacePoint([ground], { x: 2.2, y: 0.05 }, 0.3, 0.3, { allowGliders: true });
    expect(p.kind).toBe("pointOnLine");
    if (p.kind !== "pointOnLine") return;
    expect(p.bind).toBe("ground");
    expect(p.s).toBeCloseTo(2.2);
    expect(p.at.x).toBeCloseTo(2.2);
    expect(p.at.y).toBeCloseTo(0);
  });

  test("snaps to a glider on a circle", () => {
    const p = resolvePlacePoint([reach], { x: 0, y: 2.05 }, 0.3, 0.3, { allowGliders: true });
    expect(p.kind).toBe("pointOnCircle");
    if (p.kind !== "pointOnCircle") return;
    expect(p.bind).toBe("reach");
    expect(p.ux).toBeCloseTo(0);
    expect(p.uy).toBeCloseTo(1);
    expect(p.at.x).toBeCloseTo(0);
    expect(p.at.y).toBeCloseTo(2);
  });

  test("snaps to a glider on a segment", () => {
    const span = node({
      id: "o_s",
      bind: "span",
      value: { kind: "segment", a: { x: 0, y: 0 }, b: { x: 4, y: 0 } },
    });
    const p = resolvePlacePoint([span], { x: 3, y: 0.1 }, 0.3, 0.3, { allowGliders: true });
    expect(p.kind).toBe("pointOnSegment");
    if (p.kind !== "pointOnSegment") return;
    expect(p.bind).toBe("span");
    expect(p.t).toBeCloseTo(0.75);
    expect(p.at.x).toBeCloseTo(3);
    expect(p.at.y).toBeCloseTo(0);
  });

  test("prefers a named point over a glider on the same stroke", () => {
    const p = resolvePlacePoint([A, ground], { x: 0.1, y: 0 }, 0.3);
    expect(p).toMatchObject({ kind: "ref", bind: "A" });
  });

  test("glider snap can be looser than point/crossing snap", () => {
    const miss = resolvePlacePoint([ground], { x: 2, y: 0.4 }, 0.3);
    expect(miss.kind).toBe("free");
    const p = resolvePlacePoint([ground], { x: 2, y: 0.4 }, 0.3, 0.5, { allowGliders: true });
    expect(p.kind).toBe("pointOnLine");
    if (p.kind !== "pointOnLine") return;
    expect(p.bind).toBe("ground");
    expect(p.s).toBeCloseTo(2);
  });

  test("projects a world point onto a named carrier", () => {
    const p = gliderOnTraceNode(ground, { x: 3.2, y: 1 });
    expect(p).toMatchObject({ kind: "pointOnLine", bind: "ground" });
    if (p?.kind !== "pointOnLine") return;
    expect(p.s).toBeCloseTo(3.2);
    expect(p.at.y).toBeCloseTo(0);
  });

  test("skips gliders unless the Point tool asks for them", () => {
    const p = resolvePlacePoint([ground], { x: 2.2, y: 0.05 }, 0.3, 0.5);
    expect(p.kind).toBe("free");
    expect(p.at.x).toBeCloseTo(2.2);
    expect(p.at.y).toBeCloseTo(0.05);
  });

  test("places a glider on a parallel offset with allowGliders", () => {
    const p = resolvePlacePoint([shelf], { x: 2, y: 1.85 }, 0.3, 0.5, { allowGliders: true });
    expect(p.kind).toBe("pointOnLine");
    if (p.kind !== "pointOnLine") return;
    expect(p.bind).toBe("shelf");
    expect(gliderOnTraceNode(shelf, { x: 2, y: 1.85 })).toMatchObject({ kind: "pointOnLine", bind: "shelf" });
  });

  test("does not snap to a crossing past a segment's endpoints", () => {
    const ab = node({
      id: "o_ab",
      bind: "ab",
      value: { kind: "segment", a: { x: 0, y: 0 }, b: { x: 1, y: 0 } },
    });
    const cd = node({
      id: "o_cd",
      bind: "cd",
      value: { kind: "segment", a: { x: 2, y: 1 }, b: { x: 2, y: 2 } },
    });
    const p = resolvePlacePoint([ab, cd], { x: 2, y: 0 }, 0.3);
    expect(p.kind).toBe("free");
  });

  test("snaps when two segments actually cross", () => {
    const ab = node({
      id: "o_ab",
      bind: "ab",
      value: { kind: "segment", a: { x: 0, y: 0 }, b: { x: 2, y: 0 } },
    });
    const cd = node({
      id: "o_cd",
      bind: "cd",
      value: { kind: "segment", a: { x: 1, y: -1 }, b: { x: 1, y: 1 } },
    });
    const p = resolvePlacePoint([ab, cd], { x: 1.05, y: 0.02 }, 0.3);
    expect(p.kind).toBe("lineIntersection");
    if (p.kind !== "lineIntersection") return;
    expect(p.at.x).toBeCloseTo(1);
    expect(p.at.y).toBeCloseTo(0);
  });

  test("snaps a T-junction at a segment endpoint", () => {
    const ab = node({
      id: "o_ab",
      bind: "ab",
      value: { kind: "segment", a: { x: 0, y: 0 }, b: { x: 2, y: 0 } },
    });
    const stem = node({
      id: "o_st",
      bind: "stem",
      value: { kind: "segment", a: { x: 1, y: 0 }, b: { x: 1, y: 1 } },
    });
    const p = resolvePlacePoint([ab, stem], { x: 1, y: 0 }, 0.3);
    expect(p.kind).toBe("lineIntersection");
  });

  test("circle-line snap ignores a hit past a segment", () => {
    const span = node({
      id: "o_s",
      bind: "span",
      value: { kind: "segment", a: { x: 3, y: 0 }, b: { x: 4, y: 0 } },
    });
    const miss = resolvePlacePoint([reach, span], { x: 2, y: 0 }, 0.3);
    expect(miss.kind).toBe("free");
    const on = node({
      id: "o_on",
      bind: "on",
      value: { kind: "segment", a: { x: 0, y: 0 }, b: { x: 3, y: 0 } },
    });
    const hit = resolvePlacePoint([reach, on], { x: 2, y: 0 }, 0.3);
    expect(hit).toMatchObject({ kind: "circleLineIntersection", line: "on", k: 1 });
  });

  test("line vs segment still snaps when the hit is on the span", () => {
    const span = node({
      id: "o_s",
      bind: "span",
      value: { kind: "segment", a: { x: 1, y: -1 }, b: { x: 1, y: 1 } },
    });
    const p = resolvePlacePoint([ground, span], { x: 1, y: 0 }, 0.3);
    expect(p.kind).toBe("lineIntersection");
    const past = node({
      id: "o_p",
      bind: "past",
      value: { kind: "segment", a: { x: 1, y: 1 }, b: { x: 1, y: 2 } },
    });
    const miss = resolvePlacePoint([ground, past], { x: 1, y: 0 }, 0.3);
    expect(miss.kind).toBe("free");
  });
});
