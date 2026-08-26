import { describe, expect, test } from "vitest";

import { alongValue, filletValue, profileContains, profileValue, signedDistToProfile } from "./profile";
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

  test("fillet(A, r) rounds one corner of a square and leaves the rest sharp", () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ];
    const cycle: unknown[] = [];
    for (let i = 0; i < 4; i++) {
      const a = pts[i]!;
      const b = pts[(i + 1) % 4]!;
      cycle.push(i === 0 ? filletValue(a, 0.2) : a, { kind: "segment", a, b } satisfies Segment);
    }
    const p = profileValue(cycle);
    expect(p.outer).toHaveLength(5);
    expect(p.outer.filter((e) => e.carrier.kind === "circle")).toHaveLength(1);
    expect(profileContains(p, { x: 0.5, y: 0.5 })).toBe(true);
    expect(profileContains(p, { x: 0.05, y: 0.05 })).toBe(false);
    expect(profileContains(p, { x: 0.95, y: 0.95 })).toBe(true);
  });

  test("fillet of every square corner is four lines plus four quarter joins", () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ];
    const cycle: unknown[] = [];
    for (let i = 0; i < 4; i++) {
      const a = pts[i]!;
      const b = pts[(i + 1) % 4]!;
      cycle.push(filletValue(a, 0.2), { kind: "segment", a, b } satisfies Segment);
    }
    const p = profileValue(cycle);
    expect(p.outer).toHaveLength(8);
    expect(p.outer.filter((e) => e.carrier.kind === "circle")).toHaveLength(4);
    expect(profileContains(p, { x: 0.5, y: 0.5 })).toBe(true);
    expect(profileContains(p, { x: 0.05, y: 0.05 })).toBe(false);
  });

  test("fillet radius past the edge collapses", () => {
    const a = { x: 0, y: 0 };
    const b = { x: 1, y: 0 };
    const c = { x: 0, y: 1 };
    const p = profileValue([
      filletValue(a, 1.1),
      { kind: "segment", a, b } satisfies Segment,
      b,
      { kind: "segment", a: b, b: c } satisfies Segment,
      c,
      { kind: "segment", a: c, b: a } satisfies Segment,
    ]);
    expect(p.outer).toHaveLength(0);
  });

  test("r === 0 is a sharp vertex", () => {
    const a = { x: 0, y: 0 };
    const b = { x: 1, y: 0 };
    const c = { x: 0, y: 1 };
    const p = profileValue([
      filletValue(a, 0),
      { kind: "segment", a, b } satisfies Segment,
      b,
      { kind: "segment", a: b, b: c } satisfies Segment,
      c,
      { kind: "segment", a: c, b: a } satisfies Segment,
    ]);
    expect(p.outer).toHaveLength(3);
    expect(p.outer.every((e) => e.carrier.kind !== "circle")).toBe(true);
  });
});

describe("signedDistToProfile", () => {
  test("outside is positive, inside is negative", () => {
    const slice = profileValue([A, chord, B, alongValue(c, -1)]);
    expect(signedDistToProfile(slice, { x: 0.2, y: 0.2 })).toBeGreaterThan(0);
    expect(signedDistToProfile(slice, { x: 1.4, y: 1.4 })).toBeLessThan(0);
  });
});
