import { describe, expect, test } from "vitest";

import { alongValue, filletValue, profileContains, profileValue, signedDistToProfile } from "./profile";
import { roundOffsetValue } from "./offset";
import type { Circle, Segment } from "./types";
import type { Vec2 } from "./vec";

const A = { x: 2, y: 0 };
const B = { x: 0, y: 2 };
const chord: Segment = { kind: "segment", a: A, b: B };
const c: Circle = { kind: "circle", center: { x: 0, y: 0 }, radius: 2 };

function seg(a: Vec2, b: Vec2): Segment {
  return { kind: "segment", a, b };
}

function closed(pts: readonly Vec2[], radii: readonly (number | undefined)[] = []) {
  const cycle: unknown[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    const r = radii[i];
    cycle.push(r != null ? filletValue(a, r) : a, seg(a, b));
  }
  return profileValue(cycle);
}

const squarePts = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

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
    const cpt = { x: 0, y: 1 };
    const p = profileValue([
      filletValue(a, 1.1),
      { kind: "segment", a, b } satisfies Segment,
      b,
      { kind: "segment", a: b, b: cpt } satisfies Segment,
      cpt,
      { kind: "segment", a: cpt, b: a } satisfies Segment,
    ]);
    expect(p.outer).toHaveLength(0);
  });

  test("r === 0 is a sharp vertex", () => {
    const a = { x: 0, y: 0 };
    const b = { x: 1, y: 0 };
    const cpt = { x: 0, y: 1 };
    const p = profileValue([
      filletValue(a, 0),
      { kind: "segment", a, b } satisfies Segment,
      b,
      { kind: "segment", a: b, b: cpt } satisfies Segment,
      cpt,
      { kind: "segment", a: cpt, b: a } satisfies Segment,
    ]);
    expect(p.outer).toHaveLength(3);
    expect(p.outer.every((e) => e.carrier.kind !== "circle")).toBe(true);
  });

  test("concave L-notch fillet adds material in the pocket", () => {
    const p = closed(
      [
        { x: 0, y: 0 },
        { x: 2, y: 0 },
        { x: 2, y: 1 },
        { x: 1, y: 1 },
        { x: 1, y: 2 },
        { x: 0, y: 2 },
      ],
      [undefined, undefined, undefined, 0.2],
    );
    expect(p.outer).toHaveLength(7);
    expect(p.outer.filter((e) => e.carrier.kind === "circle")).toHaveLength(1);
    const arc = p.outer.find((e) => e.carrier.kind === "circle");
    expect(arc?.carrier.kind === "circle" && arc.carrier.center.x).toBeCloseTo(1.2);
    expect(arc?.carrier.kind === "circle" && arc.carrier.center.y).toBeCloseTo(1.2);
    expect(profileContains(p, { x: 0.4, y: 0.4 })).toBe(true);
    expect(profileContains(p, { x: 1.05, y: 1.05 })).toBe(true);
    expect(profileContains(p, { x: 1.5, y: 1.5 })).toBe(false);
  });

  test("adjacent fillets that fit on an edge stay; ones that overlap collapse", () => {
    expect(closed(squarePts, [0.4, 0.4]).outer).toHaveLength(6);
    expect(closed(squarePts, [0.51, 0.51]).outer).toHaveLength(0);
  });

  test("fillet of a 90° sector rim is a line-circle join; the tip can stay sharp", () => {
    const O = { x: 0, y: 0 };
    const oa = seg(O, A);
    const ob = seg(O, B);
    const p = profileValue([O, oa, filletValue(A, 0.25), alongValue(c, 1), filletValue(B, 0.25), ob]);
    expect(p.outer).toHaveLength(5);
    expect(p.outer.filter((e) => e.carrier.kind === "circle")).toHaveLength(3);
    expect(profileContains(p, { x: 0.8, y: 0.8 })).toBe(true);
    expect(profileContains(p, { x: 1.95, y: 0.05 })).toBe(false);
    expect(profileContains(p, { x: 0.05, y: 1.95 })).toBe(false);
    expect(profileContains(p, { x: 0.1, y: 0.1 })).toBe(true);
  });

  test("rim fillets on a major arc follow k, not the chord", () => {
    const O = { x: 0, y: 0 };
    const R = 2;
    const reach: Circle = { kind: "circle", center: O, radius: R };
    const P = { x: R, y: 0 };
    for (const deg of [200, 270]) {
      const a = (deg * Math.PI) / 180;
      const Q = { x: R * Math.cos(a), y: R * Math.sin(a) };
      const p = profileValue([
        O,
        seg(O, P),
        filletValue(P, 0.35),
        alongValue(reach, 1),
        filletValue(Q, 0.35),
        seg(O, Q),
      ]);
      expect(p.outer).toHaveLength(5);
      expect(p.outer.filter((e) => e.carrier.kind === "circle")).toHaveLength(3);
      expect(profileContains(p, { x: 0.4, y: 0.4 })).toBe(true);
      expect(profileContains(p, { x: 1.95, y: 0.05 })).toBe(false);
    }
  });

  test("fillet at a sector origin rounds the tip", () => {
    const O = { x: 0, y: 0 };
    const p = profileValue([filletValue(O, 0.3), seg(O, A), A, alongValue(c, 1), B, seg(O, B)]);
    expect(p.outer).toHaveLength(4);
    expect(profileContains(p, { x: 0.8, y: 0.8 })).toBe(true);
    expect(profileContains(p, { x: 0.05, y: 0.05 })).toBe(false);
  });

  test("fillet at a 180° sector origin is a no-op (already flat)", () => {
    const O = { x: 0, y: 0 };
    const P = { x: 2, y: 0 };
    const Q = { x: -2, y: 0 };
    const cycle = [O, seg(O, P), P, alongValue(c, 1), Q, seg(O, Q)];
    const p = profileValue([filletValue(O, 0.2), ...cycle.slice(1)]);
    const sharp = profileValue(cycle);
    expect(p.outer).toHaveLength(3);
    expect(p.outer.filter((e) => e.carrier.kind === "circle")).toHaveLength(1);
    expect(p.outer).toHaveLength(sharp.outer.length);
    expect(profileContains(p, { x: 0, y: 1 })).toBe(true);
    expect(profileContains(p, { x: 0.1, y: 0.1 })).toBe(true);
  });

  test("clockwise square fillet still cuts the corner", () => {
    const p = closed(
      [
        { x: 0, y: 0 },
        { x: 0, y: 1 },
        { x: 1, y: 1 },
        { x: 1, y: 0 },
      ],
      [0.2],
    );
    expect(p.outer).toHaveLength(5);
    expect(profileContains(p, { x: 0.5, y: 0.5 })).toBe(true);
    expect(profileContains(p, { x: 0.05, y: 0.05 })).toBe(false);
  });

  test("negative fillet radius is empty, not a throw", () => {
    expect(closed(squarePts, [-0.2]).outer).toHaveLength(0);
  });

  test("round offset of a filleted square keeps the rounded corners", () => {
    const face = closed(squarePts, [0.2, 0.2, 0.2, 0.2]);
    const out = roundOffsetValue(face, -0.1);
    expect(out).toHaveLength(1);
    const p = out[0]!;
    expect(p.outer.filter((e) => e.carrier.kind === "circle")).toHaveLength(4);
    expect(profileContains(p, { x: 0.5, y: 0.5 })).toBe(true);
    expect(profileContains(p, { x: 0.12, y: 0.12 })).toBe(false);
    expect(profileContains(p, { x: 0.05, y: 0.05 })).toBe(false);
  });
});

describe("signedDistToProfile", () => {
  test("outside is positive, inside is negative", () => {
    const slice = profileValue([A, chord, B, alongValue(c, -1)]);
    expect(signedDistToProfile(slice, { x: 0.2, y: 0.2 })).toBeGreaterThan(0);
    expect(signedDistToProfile(slice, { x: 1.4, y: 1.4 })).toBeLessThan(0);
  });
});
