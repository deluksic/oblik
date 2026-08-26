import { describe, expect, test } from "vitest";

import { circleCircleIntersectionValue, circleLineIntersectionValue } from "./ops";
import type { Circle } from "./types";

const a: Circle = { kind: "circle", center: { x: 0, y: 0 }, radius: 2 };
const b: Circle = { kind: "circle", center: { x: 2, y: 0 }, radius: 2 };

import { dot, perp } from "./vec";
import { lineBasis, perpendicularLineValue } from "./ops";
import type { Line } from "./types";

const ground: Line = { kind: "line", origin: { x: 0, y: 0 }, direction: { x: 1, y: 0 } };

describe("perpendicularLineValue", () => {
  test("passes through the point and is normal to the carrier", () => {
    const through = { x: 2, y: 3 };
    const perpLn = perpendicularLineValue(ground, through);
    expect(perpLn.origin).toEqual(through);
    const { dir } = lineBasis(ground);
    expect(dot(perpLn.direction, dir)).toBeCloseTo(0);
    expect(dot(perpLn.direction, perp(dir))).toBeGreaterThan(0);
  });
});

describe("circleCircleIntersectionValue", () => {
  test("freezes k as the side of the center line", () => {
    const plus = circleCircleIntersectionValue(a, b, 1);
    const minus = circleCircleIntersectionValue(a, b, -1);
    expect(plus.x).toBeCloseTo(1);
    expect(plus.y).toBeCloseTo(Math.sqrt(3));
    expect(minus.x).toBeCloseTo(1);
    expect(minus.y).toBeCloseTo(-Math.sqrt(3));
  });

  test("misses are NaN, not a hop to the other root", () => {
    const far: Circle = { kind: "circle", center: { x: 10, y: 0 }, radius: 1 };
    const p = circleCircleIntersectionValue(a, far, 1);
    expect(p.x).toBeNaN();
    expect(p.y).toBeNaN();
  });

  test("coincident centers are NaN", () => {
    const same: Circle = { kind: "circle", center: { x: 0, y: 0 }, radius: 3 };
    const p = circleCircleIntersectionValue(a, same, 1);
    expect(p.x).toBeNaN();
  });
});

describe("circleLineIntersectionValue", () => {
  test("a numerically shy tangent still hits", () => {
    const c: Circle = { kind: "circle", center: { x: 0, y: 0 }, radius: 1 };
    const line = { kind: "line" as const, origin: { x: 1 + 1e-12, y: 0 }, direction: { x: 0, y: 1 } };
    const p = circleLineIntersectionValue(c, line, 1);
    expect(p.x).toBeCloseTo(1, 6);
    expect(p.y).toBeCloseTo(0, 6);
  });
});
