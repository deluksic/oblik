import { describe, expect, test } from "vitest";

import {
  isFinitePolygon,
  isPolygon,
  nanPolygon,
  polygonContains,
  polygonSvgPath,
  polygonValue,
} from "./polygon";
import { isCircleWalk } from "./region";
import type { Circle, Segment } from "./types";
import type { Vec2 } from "./vec";


const square = (): Vec2[] => [
  { x: 0, y: 0 },
  { x: 2, y: 0 },
  { x: 2, y: 2 },
  { x: 0, y: 2 },
];

const seg = (a: Vec2, b: Vec2): Segment => ({ kind: "segment", a, b });

describe("polygonValue", () => {
  test("a plain boundary is a finite cheese with no holes", () => {
    const p = polygonValue(square(), []);
    expect(isPolygon(p)).toBe(true);
    expect(isFinitePolygon(p)).toBe(true);
    expect(p.holes).toHaveLength(0);
    expect(polygonContains(p, { x: 1, y: 1 })).toBe(true);
    expect(polygonContains(p, { x: 2.1, y: 1 })).toBe(false);
    expect(polygonContains(p, { x: -0.1, y: 1 })).toBe(false);
  });

  test("an explicitly closed ring (first repeated at the end) is tolerated", () => {
    const closed = [...square(), { x: 0, y: 0 }];
    const p = polygonValue(closed, []);
    expect(isFinitePolygon(p)).toBe(true);
    expect(p.boundary).toHaveLength(4);
    expect(polygonContains(p, { x: 1, y: 1 })).toBe(true);
  });

  test("consecutive duplicate points are dropped", () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
      { x: 0, y: 2 },
      { x: 0, y: 2 },
    ];
    const p = polygonValue(pts, []);
    expect(isFinitePolygon(p)).toBe(true);
    expect(p.boundary).toHaveLength(4);
  });

  test("fewer than three distinct points is an empty polygon", () => {
    const p = polygonValue([{ x: 0, y: 0 }, { x: 1, y: 0 }], []);
    expect(p.boundary).toHaveLength(0);
    expect(isFinitePolygon(p)).toBe(false);
    expect(polygonContains(p, { x: 0.5, y: 0 })).toBe(false);
    expect(p).toEqual(nanPolygon());
  });

  test("a full-circle hole punches the centre", () => {
    const p = polygonValue(square(), [{ kind: "circle", center: { x: 1, y: 1 }, radius: 0.5 }]);
    expect(isFinitePolygon(p)).toBe(true);
    expect(p.holes).toHaveLength(1);
    expect(p.holes.every(isCircleWalk)).toBe(true);
    expect(polygonContains(p, { x: 1, y: 1 })).toBe(false);
    expect(polygonContains(p, { x: 0.2, y: 0.2 })).toBe(true);
  });

  test("a hole that escapes the boundary is invalid", () => {
    const p = polygonValue(square(), [{ kind: "circle", center: { x: 1, y: 1 }, radius: 2 }]);
    expect(p).toEqual(nanPolygon());
  });

  test("overlapping holes are invalid", () => {
    const circle = (x: number): Circle => ({ kind: "circle", center: { x, y: 1 }, radius: 0.55 });
    const p = polygonValue(square(), [circle(0.9), circle(1.3)]);
    expect(p).toEqual(nanPolygon());
  });

  test("a declared carrier-cycle hole works", () => {
    const A = { x: 0.5, y: 0.5 };
    const B = { x: 1.5, y: 0.5 };
    const C = { x: 1.5, y: 1.5 };
    const D = { x: 0.5, y: 1.5 };
    const hole = [A, seg(A, B), B, seg(B, C), C, seg(C, D), D, seg(D, A)];
    const p = polygonValue(square(), [hole]);
    expect(isFinitePolygon(p)).toBe(true);
    expect(polygonContains(p, { x: 1, y: 1 })).toBe(false);
    expect(polygonContains(p, { x: 0.25, y: 0.25 })).toBe(true);
  });

  test("holes must not touch the boundary", () => {
    const near = polygonValue(square(), [
      { kind: "circle", center: { x: 1, y: 1 }, radius: 0.99 },
    ]);
    expect(isFinitePolygon(near)).toBe(true);
    const grazing = polygonValue(square(), [
      { kind: "circle", center: { x: 1, y: 1 }, radius: 1 },
    ]);
    expect(grazing).toEqual(nanPolygon());
  });

  test("polygonSvgPath is one even-odd path of boundary plus holes", () => {
    const p = polygonValue(square(), [
      { kind: "circle", center: { x: 1, y: 1 }, radius: 0.5 },
    ]);
    const d = polygonSvgPath(p);
    expect(d.startsWith("M 0 0 L 2 0 L 2 2 L 0 2 Z")).toBe(true);
    expect(d.match(/Z/g)).toHaveLength(2);
    expect(polygonSvgPath(polygonValue(square(), []))).toBe("M 0 0 L 2 0 L 2 2 L 0 2 Z");
  });
});
