import { describe, expect, test } from "vitest";

import {
  circleUnitAt,
  pointOnCircleValue,
  pointOnLineValue,
  pointOnSegmentValue,
  segmentTAt,
  segmentTUnclamped,
} from "./gliders";
import type { Circle, Segment } from "./types";

const span: Segment = { kind: "segment", a: { x: 0, y: 0 }, b: { x: 4, y: 0 } };
const ground = { kind: "line" as const, origin: { x: 0, y: 0 }, direction: { x: 1, y: 0 } };
const reach: Circle = { kind: "circle", center: { x: 0, y: 0 }, radius: 2 };

describe("gliders", () => {
  test("pointOnSegment interpolates with t in [0, 1]", () => {
    const g = pointOnSegmentValue(span, 0.25);
    expect(g).toMatchObject({ kind: "gliderSegment", t: 0.25, x: 1, y: 0 });
    expect(pointOnSegmentValue(span, 1.5).t).toBe(1);
    expect(pointOnSegmentValue(span, -1).t).toBe(0);
  });

  test("pointOnLine uses signed world distance along the carrier", () => {
    const g = pointOnLineValue(ground, 2.5);
    expect(g).toMatchObject({ kind: "gliderLine", s: 2.5, x: 2.5, y: 0 });
  });

  test("pointOnCircle stores a unit direction and lies on the circle", () => {
    const g = pointOnCircleValue(reach, 0, 1);
    expect(g.ux).toBeCloseTo(0);
    expect(g.uy).toBeCloseTo(1);
    expect(g.x).toBeCloseTo(0);
    expect(g.y).toBeCloseTo(2);
  });

  test("segmentTAt and circleUnitAt measure from a world point", () => {
    expect(segmentTAt(span, { x: 2, y: 0 })).toBe(0.5);
    expect(segmentTUnclamped(span, { x: 6, y: 0 })).toBe(1.5);
    expect(segmentTUnclamped(span, { x: -2, y: 0 })).toBe(-0.5);
    const u = circleUnitAt(reach, { x: 2, y: 0 });
    expect(u.ux).toBeCloseTo(1);
    expect(u.uy).toBeCloseTo(0);
  });
});
