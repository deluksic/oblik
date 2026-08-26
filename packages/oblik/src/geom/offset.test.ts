import { describe, expect, test } from "vitest";

import { alongValue, filletValue, profileContains, profileValue } from "./profile";
import { filletAtVertex, profileCorners, roundOffsetValue } from "./offset";
import { pointOnCircleValue } from "./gliders";
import type { Circle, Profile, Segment } from "./types";
import type { Vec2 } from "./vec";

function poly(pts: readonly Vec2[]): Profile {
  const cycle: unknown[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    cycle.push(a, { kind: "segment", a, b } satisfies Segment);
  }
  return profileValue(cycle);
}

const square = poly([
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
]);

const A = { x: 2, y: 0 };
const B = { x: 0, y: 2 };
const chord: Segment = { kind: "segment", a: A, b: B };
const reach: Circle = { kind: "circle", center: { x: 0, y: 0 }, radius: 2 };
const slice = profileValue([A, chord, B, alongValue(reach, -1)]);

function roundedSquare(r: number): Profile {
  const pts: Vec2[] = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ];
  const cycle: unknown[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    cycle.push(filletValue(a, r), { kind: "segment", a, b } satisfies Segment);
  }
  return profileValue(cycle);
}

function sector(deg: number): Profile {
  const r = 2;
  const a = (deg * Math.PI) / 180;
  const O = { x: 0, y: 0 };
  const P = { x: r, y: 0 };
  const Q = { x: r * Math.cos(a), y: r * Math.sin(a) };
  const oa: Segment = { kind: "segment", a: O, b: P };
  const ob: Segment = { kind: "segment", a: O, b: Q };
  const c: Circle = { kind: "circle", center: O, radius: r };
  return profileValue([O, oa, P, alongValue(c, 1), Q, ob]);
}

describe("roundOffsetValue", () => {
  test("d === 0 is a copy", () => {
    const out = roundOffsetValue(square, 0);
    expect(out).toHaveLength(1);
    expect(out[0]?.outer).toHaveLength(4);
    expect(out[0]).not.toBe(square);
    expect(profileContains(out[0]!, { x: 0.5, y: 0.5 })).toBe(true);
  });

  test("CCW square inset miters to four edges", () => {
    const out = roundOffsetValue(square, -0.2);
    expect(out).toHaveLength(1);
    const p = out[0]!;
    expect(p.outer).toHaveLength(4);
    expect(p.outer.every((e) => e.carrier.kind !== "circle")).toBe(true);
    expect(profileContains(p, { x: 0.5, y: 0.5 })).toBe(true);
    expect(profileContains(p, { x: 1, y: 1 })).toBe(false);
    expect(profileContains(p, { x: 0.05, y: 0.05 })).toBe(false);
    expect(p.outer[0]?.a.x).toBeCloseTo(0.2);
    expect(p.outer[0]?.a.y).toBeCloseTo(0.2);
    expect(p.outer[0]?.b.x).toBeCloseTo(0.8);
    expect(p.outer[0]?.b.y).toBeCloseTo(0.2);
  });

  test("CCW square outset is four offsets plus four quarter joins", () => {
    const out = roundOffsetValue(square, 0.2);
    expect(out).toHaveLength(1);
    const p = out[0]!;
    expect(p.outer).toHaveLength(8);
    expect(p.outer.filter((e) => e.carrier.kind === "circle")).toHaveLength(4);
    expect(p.outer.filter((e) => e.carrier.kind === "circle").every((e) => e.k === 1)).toBe(true);
    expect(profileContains(p, { x: 0.5, y: 0.5 })).toBe(true);
    expect(profileContains(p, { x: 1, y: 1 })).toBe(true);
    expect(profileContains(p, { x: 1.1, y: 0.5 })).toBe(true);
    expect(profileContains(p, { x: 1.1, y: 1.1 })).toBe(true);
    expect(profileContains(p, { x: 1.2, y: 1.2 })).toBe(false);
  });

  test("square inset past half-side collapses", () => {
    expect(roundOffsetValue(square, -0.5)).toEqual([]);
    expect(roundOffsetValue(square, -0.6)).toEqual([]);
  });

  test("slice inset keeps a point in the cap; large |d| empties", () => {
    const small = roundOffsetValue(slice, -0.12);
    expect(small).toHaveLength(1);
    expect(small[0]?.outer).toHaveLength(2);
    expect(profileContains(small[0]!, { x: 1.25, y: 1.25 })).toBe(true);
    expect(profileContains(small[0]!, { x: 0.2, y: 0.2 })).toBe(false);
    expect(roundOffsetValue(slice, -0.5)).toEqual([]);
  });

  test("180° sector inset offsets the diameter instead of missing the miter", () => {
    const out = roundOffsetValue(sector(180), -0.12);
    expect(out).toHaveLength(1);
    const p = out[0]!;
    expect(p.outer).toHaveLength(3);
    expect(p.outer.filter((e) => e.carrier.kind === "circle")).toHaveLength(1);
    expect(profileContains(p, { x: 0, y: 1 })).toBe(true);
    expect(profileContains(p, { x: 0, y: 0 })).toBe(false);
    expect(profileContains(p, { x: 0, y: 0.05 })).toBe(false);
    expect(p.outer[0]?.a.y).toBeCloseTo(0.12);
    expect(p.outer[0]?.b.y).toBeCloseTo(0.12);
  });

  test("sectors just under and over 180° still inset", () => {
    expect(roundOffsetValue(sector(179.5), -0.12)).toHaveLength(1);
    expect(roundOffsetValue(sector(180.5), -0.12)).toHaveLength(1);
  });

  test("200° sector inset keeps the major arc", () => {
    const out = roundOffsetValue(sector(200), -0.12);
    expect(out).toHaveLength(1);
    const p = out[0]!;
    expect(p.outer).toHaveLength(4);
    expect(p.outer.filter((e) => e.carrier.kind === "circle")).toHaveLength(2);
    expect(profileContains(p, { x: 0.4, y: 0.4 })).toBe(true);
    expect(profileContains(p, { x: 0, y: 0 })).toBe(false);
  });

  test("slice outset rounds the tips", () => {
    const out = roundOffsetValue(slice, 0.15);
    expect(out).toHaveLength(1);
    expect(out[0]?.outer).toHaveLength(4);
    expect(out[0]?.outer.filter((e) => e.carrier.kind === "circle")).toHaveLength(3);
    expect(profileContains(out[0]!, { x: 1.4, y: 1.4 })).toBe(true);
  });

  test("filleted square inset past r drops the arcs and keeps a sharp inner square", () => {
    const face = roundedSquare(0.05);
    expect(face.outer).toHaveLength(8);
    const out = roundOffsetValue(face, -0.12);
    expect(out).toHaveLength(1);
    const p = out[0]!;
    expect(p.outer).toHaveLength(4);
    expect(p.outer.every((e) => e.carrier.kind !== "circle")).toBe(true);
    expect(profileContains(p, { x: 0.5, y: 0.5 })).toBe(true);
    expect(profileContains(p, { x: 0.05, y: 0.05 })).toBe(false);
    expect(p.outer[0]?.a.x).toBeCloseTo(0.12);
    expect(p.outer[0]?.a.y).toBeCloseTo(0.12);
  });

  test("filleted square inset at d === r is the same sharp remnant", () => {
    const out = roundOffsetValue(roundedSquare(0.12), -0.12);
    expect(out).toHaveLength(1);
    const p = out[0]!;
    expect(p.outer).toHaveLength(4);
    expect(p.outer.every((e) => e.carrier.kind !== "circle")).toBe(true);
    expect(profileContains(p, { x: 0.5, y: 0.5 })).toBe(true);
    expect(profileContains(p, { x: 0.05, y: 0.05 })).toBe(false);
  });

  test("inset past a single fillet drops that arc and miters the remnant", () => {
    const pts: Vec2[] = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ];
    const cycle: unknown[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]!;
      const b = pts[(i + 1) % pts.length]!;
      cycle.push(i === 0 ? filletValue(a, 0.05) : a, { kind: "segment", a, b } satisfies Segment);
    }
    const face = profileValue(cycle);
    expect(face.outer).toHaveLength(5);
    const out = roundOffsetValue(face, -0.12);
    expect(out).toHaveLength(1);
    const p = out[0]!;
    expect(p.outer).toHaveLength(4);
    expect(p.outer.every((e) => e.carrier.kind !== "circle")).toBe(true);
    expect(profileContains(p, { x: 0.5, y: 0.5 })).toBe(true);
    expect(profileContains(p, { x: 0.05, y: 0.05 })).toBe(false);
  });

  test("filleted square inset shallower than r keeps the rounded corners", () => {
    const out = roundOffsetValue(roundedSquare(0.2), -0.1);
    expect(out).toHaveLength(1);
    const p = out[0]!;
    expect(p.outer).toHaveLength(8);
    expect(p.outer.filter((e) => e.carrier.kind === "circle")).toHaveLength(4);
    expect(profileContains(p, { x: 0.5, y: 0.5 })).toBe(true);
    expect(profileContains(p, { x: 0.12, y: 0.12 })).toBe(false);
  });

  test("concave inset of an L gets a join arc at the notch", () => {
    const ell = poly([
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 1 },
      { x: 1, y: 1 },
      { x: 1, y: 2 },
      { x: 0, y: 2 },
    ]);
    const out = roundOffsetValue(ell, -0.15);
    expect(out).toHaveLength(1);
    const arcs = out[0]!.outer.filter((e) => e.carrier.kind === "circle");
    expect(out[0]?.outer).toHaveLength(7);
    expect(arcs).toHaveLength(1);
    expect(arcs[0]?.carrier.kind === "circle" && arcs[0].carrier.center.x).toBeCloseTo(1);
    expect(arcs[0]?.carrier.kind === "circle" && arcs[0].carrier.center.y).toBeCloseTo(1);
    expect(profileContains(out[0]!, { x: 0.4, y: 0.4 })).toBe(true);
    expect(profileContains(out[0]!, { x: 1.5, y: 1.5 })).toBe(false);
  });

  test("growing a filleted ice-cream keeps a remnant when r' is a sliver", () => {
    const O = { x: 3.69, y: 9.11 };
    const c: Circle = { kind: "circle", center: O, radius: 0.41 };
    const g = pointOnCircleValue(c, -0.52, 0.85);
    const g2 = pointOnCircleValue(c, 0.51, 0.86);
    const tip = { x: 3.76, y: 10.12 };
    const left: Segment = { kind: "segment", a: { x: g.x, y: g.y }, b: tip };
    const right: Segment = { kind: "segment", a: tip, b: { x: g2.x, y: g2.y } };
    const face = profileValue([
      tip,
      left,
      filletValue({ x: g.x, y: g.y }, 0.36),
      alongValue(c, 1),
      filletValue({ x: g2.x, y: g2.y }, 0.36),
      right,
    ]);
    expect(face.outer.length).toBe(5);
    const out = roundOffsetValue(face, 0.359);
    expect(out).toHaveLength(1);
    const p = out[0]!;
    expect(p.outer.length).toBeGreaterThanOrEqual(4);
    expect(profileContains(p, O)).toBe(true);
    expect(profileContains(p, { x: 3.69, y: 8.61 })).toBe(true);
    expect(profileContains(p, { x: 3.69, y: 8.2 })).toBe(false);
  });
});

describe("profileCorners / filletAtVertex", () => {
  test("sharp square corners sit on the four vertices", () => {
    const corners = profileCorners(square);
    expect(corners).toHaveLength(4);
    expect(corners.every((c) => c.r === 0)).toBe(true);
    expect(corners.map((c) => [c.at.x, c.at.y])).toEqual([
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ]);
  });

  test("filleted square recovers the original corner", () => {
    const face = roundedSquare(0.2);
    expect(face.outer).toHaveLength(8);
    const corners = profileCorners(face);
    expect(corners).toHaveLength(4);
    expect(corners[0]?.at.x).toBeCloseTo(0);
    expect(corners[0]?.at.y).toBeCloseTo(0);
    expect(corners[0]?.r).toBeCloseTo(0.2);
    expect(corners[1]?.at.x).toBeCloseTo(1);
    expect(corners[1]?.at.y).toBeCloseTo(0);
    expect(corners[1]?.r).toBeCloseTo(0.2);
  });

  test("filletAtVertex rounds one sharp corner and leaves the rest", () => {
    const out = filletAtVertex(square, 0, 0.2);
    expect(out.outer).toHaveLength(5);
    expect(out.outer.filter((e) => e.carrier.kind === "circle")).toHaveLength(1);
    expect(profileContains(out, { x: 0.5, y: 0.5 })).toBe(true);
    expect(profileContains(out, { x: 0.05, y: 0.05 })).toBe(false);
    expect(profileContains(out, { x: 0.95, y: 0.95 })).toBe(true);
  });

  test("filletAtVertex r === 0 on a filleted corner is sharp again", () => {
    const out = filletAtVertex(roundedSquare(0.2), 0, 0);
    expect(profileContains(out, { x: 0.05, y: 0.05 })).toBe(true);
    expect(out.outer.filter((e) => e.carrier.kind === "circle")).toHaveLength(3);
  });

  test("too-large filletAtVertex is empty", () => {
    expect(filletAtVertex(square, 0, 1.1).outer).toHaveLength(0);
    expect(filletAtVertex(square, 0, -0.2).outer).toHaveLength(0);
  });

  test("a pie along rim is not skipped as a join", () => {
    const corners = profileCorners(sector(90));
    expect(corners).toHaveLength(3);
    expect(corners.every((c) => c.r === 0)).toBe(true);
  });

  test("a stadium semicircle is not skipped as a join", () => {
    const A = { x: 0, y: 0 };
    const B = { x: 2, y: 0 };
    const C = { x: 2, y: 1 };
    const D = { x: 0, y: 1 };
    const bot: Segment = { kind: "segment", a: A, b: B };
    const top: Segment = { kind: "segment", a: C, b: D };
    const cR: Circle = { kind: "circle", center: { x: 2, y: 0.5 }, radius: 0.5 };
    const cL: Circle = { kind: "circle", center: { x: 0, y: 0.5 }, radius: 0.5 };
    const face = profileValue([B, alongValue(cR, 1), C, top, D, alongValue(cL, 1), A, bot]);
    expect(face.outer).toHaveLength(4);
    const corners = profileCorners(face);
    expect(corners).toHaveLength(4);
    expect(corners.every((c) => c.r === 0)).toBe(true);
  });
});
