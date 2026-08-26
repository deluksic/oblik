import { describe, expect, test } from "vitest";

import { alongValue, profileContains, profileValue } from "./profile";
import type { Circle, Segment } from "./types";

const A = { x: 2, y: 0 };
const B = { x: 0, y: 2 };
const chord: Segment = { kind: "segment", a: A, b: B };
const c: Circle = { kind: "circle", center: { x: 0, y: 0 }, radius: 2 };

describe("profileValue", () => {
  test("projects vertices onto an infinite supporting line", () => {
    const p = profileValue([
      { x: 2, y: 1 },
      { kind: "line", origin: { x: 0, y: 0 }, direction: { x: 1, y: 0 } },
      { x: 4, y: -3 },
      { kind: "line", origin: { x: 0, y: 0 }, direction: { x: 0, y: 1 } },
    ]);
    expect(p.outer).toHaveLength(2);
    expect(p.outer[0]?.a).toEqual({ x: 2, y: 0 });
    expect(p.outer[0]?.b).toEqual({ x: 4, y: 0 });
    expect(p.outer[1]?.a.x).toBeCloseTo(0);
    expect(p.outer[1]?.b.x).toBeCloseTo(0);
  });

  test("circular segment with along(c, -1) is the minor cap", () => {
    const slice = profileValue([A, chord, B, alongValue(c, -1)]);
    expect(slice.outer).toHaveLength(2);
    expect(profileContains(slice, { x: 1.4, y: 1.4 })).toBe(true);
    expect(profileContains(slice, { x: 0.2, y: 0.2 })).toBe(false);
  });

  test("bare circle is not a carrier", () => {
    const p = profileValue([A, chord, B, c]);
    expect(p.outer).toHaveLength(0);
  });

  test("odd cycle is empty, not a throw", () => {
    expect(profileValue([A, chord, B]).outer).toHaveLength(0);
  });
});
