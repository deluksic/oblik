import { describe, expect, test } from "vitest";

import type { TraceNode } from "../eval/context";
import { resolvePlacePoint } from "./place";

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
  id: "o_off",
  bind: "shelf",
  value: {
    kind: "offsetLine",
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

  test("circle-line works with an offset carrier", () => {
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

  test("picks the nearer crossing over a farther named point", () => {
    const p = resolvePlacePoint([A, ground, wall], { x: 2, y: 0 }, 0.3);
    expect(p.kind).toBe("lineIntersection");
  });
});
