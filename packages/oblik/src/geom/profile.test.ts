import { describe, expect, test } from "vitest";

import { roundOffsetValue } from "./offset";
import {
  alongValue,
  filletValue,
  isCircleWalk,
  regionContains,
  regionSvgPath,
  regionValue,
  signedDistToRegion,
  walkEdges,
} from "./profile";
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
  return regionValue(cycle, []);
}

function rectCycle(x0: number, y0: number, x1: number, y1: number): unknown[] {
  const bl = { x: x0, y: y0 };
  const br = { x: x1, y: y0 };
  const tr = { x: x1, y: y1 };
  const tl = { x: x0, y: y1 };
  return [bl, seg(bl, br), br, seg(br, tr), tr, seg(tr, tl), tl, seg(tl, bl)];
}

const squarePts = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

describe("regionValue", () => {
  test("projects vertices onto an infinite supporting line", () => {
    const p = regionValue(
      [
        { x: 2, y: 1 },
        { kind: "line", origin: { x: 0, y: 0 }, direction: { x: 1, y: 0 } },
        { x: 4, y: -3 },
        { kind: "line", origin: { x: 0, y: 0 }, direction: { x: 0, y: 1 } },
      ],
      [],
    );
    expect(p.outer).toHaveLength(2);
    expect(walkEdges(p.outer)[0]?.a).toEqual({ x: 2, y: 0 });
    expect(walkEdges(p.outer)[0]?.b).toEqual({ x: 4, y: 0 });
    expect(walkEdges(p.outer)[1]?.a.x).toBeCloseTo(0);
    expect(walkEdges(p.outer)[1]?.b.x).toBeCloseTo(0);
  });

  test("circular segment with along(c, -1) is the minor cap", () => {
    const slice = regionValue([A, chord, B, alongValue(c, -1)], []);
    expect(slice.outer).toHaveLength(2);
    expect(regionContains(slice, { x: 1.4, y: 1.4 })).toBe(true);
    expect(regionContains(slice, { x: 0.2, y: 0.2 })).toBe(false);
  });

  test("bare circle is not a carrier", () => {
    const p = regionValue([A, chord, B, c], []);
    expect(p.outer).toHaveLength(0);
  });

  test("odd cycle is empty, not a throw", () => {
    expect(regionValue([A, chord, B], []).outer).toHaveLength(0);
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
    const p = regionValue(cycle, []);
    expect(p.outer).toHaveLength(5);
    expect(walkEdges(p.outer).filter((e) => e.carrier.kind === "circle")).toHaveLength(1);
    expect(regionContains(p, { x: 0.5, y: 0.5 })).toBe(true);
    expect(regionContains(p, { x: 0.05, y: 0.05 })).toBe(false);
    expect(regionContains(p, { x: 0.95, y: 0.95 })).toBe(true);
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
    const p = regionValue(cycle, []);
    expect(p.outer).toHaveLength(8);
    expect(walkEdges(p.outer).filter((e) => e.carrier.kind === "circle")).toHaveLength(4);
    expect(regionContains(p, { x: 0.5, y: 0.5 })).toBe(true);
    expect(regionContains(p, { x: 0.05, y: 0.05 })).toBe(false);
  });

  test("fillet radius past the edge collapses", () => {
    const a = { x: 0, y: 0 };
    const b = { x: 1, y: 0 };
    const cpt = { x: 0, y: 1 };
    const p = regionValue(
      [
        filletValue(a, 1.1),
        { kind: "segment", a, b } satisfies Segment,
        b,
        { kind: "segment", a: b, b: cpt } satisfies Segment,
        cpt,
        { kind: "segment", a: cpt, b: a } satisfies Segment,
      ],
      [],
    );
    expect(p.outer).toHaveLength(0);
  });

  test("r === 0 is a sharp vertex", () => {
    const a = { x: 0, y: 0 };
    const b = { x: 1, y: 0 };
    const cpt = { x: 0, y: 1 };
    const p = regionValue(
      [
        filletValue(a, 0),
        { kind: "segment", a, b } satisfies Segment,
        b,
        { kind: "segment", a: b, b: cpt } satisfies Segment,
        cpt,
        { kind: "segment", a: cpt, b: a } satisfies Segment,
      ],
      [],
    );
    expect(p.outer).toHaveLength(3);
    expect(walkEdges(p.outer).every((e) => e.carrier.kind !== "circle")).toBe(true);
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
    expect(walkEdges(p.outer).filter((e) => e.carrier.kind === "circle")).toHaveLength(1);
    const arc = walkEdges(p.outer).find((e) => e.carrier.kind === "circle");
    expect(arc?.carrier.kind === "circle" && arc.carrier.center.x).toBeCloseTo(1.2);
    expect(arc?.carrier.kind === "circle" && arc.carrier.center.y).toBeCloseTo(1.2);
    expect(regionContains(p, { x: 0.4, y: 0.4 })).toBe(true);
    expect(regionContains(p, { x: 1.05, y: 1.05 })).toBe(true);
    expect(regionContains(p, { x: 1.5, y: 1.5 })).toBe(false);
  });

  test("adjacent fillets that fit on an edge stay; ones that overlap collapse", () => {
    expect(closed(squarePts, [0.4, 0.4]).outer).toHaveLength(6);
    expect(closed(squarePts, [0.51, 0.51]).outer).toHaveLength(0);
  });

  test("fillet of a 90° sector rim is a line-circle join; the tip can stay sharp", () => {
    const O = { x: 0, y: 0 };
    const oa = seg(O, A);
    const ob = seg(O, B);
    const p = regionValue(
      [O, oa, filletValue(A, 0.25), alongValue(c, 1), filletValue(B, 0.25), ob],
      [],
    );
    expect(p.outer).toHaveLength(5);
    expect(walkEdges(p.outer).filter((e) => e.carrier.kind === "circle")).toHaveLength(3);
    expect(regionContains(p, { x: 0.8, y: 0.8 })).toBe(true);
    expect(regionContains(p, { x: 1.95, y: 0.05 })).toBe(false);
    expect(regionContains(p, { x: 0.05, y: 1.95 })).toBe(false);
    expect(regionContains(p, { x: 0.1, y: 0.1 })).toBe(true);
  });

  test("rim fillets on a major arc follow k, not the chord", () => {
    const O = { x: 0, y: 0 };
    const R = 2;
    const reach: Circle = { kind: "circle", center: O, radius: R };
    const P = { x: R, y: 0 };
    for (const deg of [200, 270]) {
      const a = (deg * Math.PI) / 180;
      const Q = { x: R * Math.cos(a), y: R * Math.sin(a) };
      const p = regionValue(
        [O, seg(O, P), filletValue(P, 0.35), alongValue(reach, 1), filletValue(Q, 0.35), seg(O, Q)],
        [],
      );
      expect(p.outer).toHaveLength(5);
      expect(walkEdges(p.outer).filter((e) => e.carrier.kind === "circle")).toHaveLength(3);
      expect(regionContains(p, { x: 0.4, y: 0.4 })).toBe(true);
      expect(regionContains(p, { x: 1.95, y: 0.05 })).toBe(false);
    }
  });

  test("fillet at a sector origin rounds the tip", () => {
    const O = { x: 0, y: 0 };
    const p = regionValue([filletValue(O, 0.3), seg(O, A), A, alongValue(c, 1), B, seg(O, B)], []);
    expect(p.outer).toHaveLength(4);
    expect(regionContains(p, { x: 0.8, y: 0.8 })).toBe(true);
    expect(regionContains(p, { x: 0.05, y: 0.05 })).toBe(false);
  });

  test("fillet at a 180° sector origin is a no-op (already flat)", () => {
    const O = { x: 0, y: 0 };
    const P = { x: 2, y: 0 };
    const Q = { x: -2, y: 0 };
    const cycle = [O, seg(O, P), P, alongValue(c, 1), Q, seg(O, Q)];
    const p = regionValue([filletValue(O, 0.2), ...cycle.slice(1)], []);
    const sharp = regionValue(cycle, []);
    expect(p.outer).toHaveLength(3);
    expect(walkEdges(p.outer).filter((e) => e.carrier.kind === "circle")).toHaveLength(1);
    expect(walkEdges(p.outer)).toHaveLength(walkEdges(sharp.outer).length);
    expect(regionContains(p, { x: 0, y: 1 })).toBe(true);
    expect(regionContains(p, { x: 0.1, y: 0.1 })).toBe(true);
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
    expect(regionContains(p, { x: 0.5, y: 0.5 })).toBe(true);
    expect(regionContains(p, { x: 0.05, y: 0.05 })).toBe(false);
  });

  test("negative fillet radius is empty, not a throw", () => {
    expect(closed(squarePts, [-0.2]).outer).toHaveLength(0);
  });

  test("round offset of a filleted square keeps the rounded corners", () => {
    const face = closed(squarePts, [0.2, 0.2, 0.2, 0.2]);
    const out = roundOffsetValue(face, -0.1);
    expect(out).toHaveLength(1);
    const p = out[0]!;
    expect(walkEdges(p.outer).filter((e) => e.carrier.kind === "circle")).toHaveLength(4);
    expect(regionContains(p, { x: 0.5, y: 0.5 })).toBe(true);
    expect(regionContains(p, { x: 0.12, y: 0.12 })).toBe(false);
    expect(regionContains(p, { x: 0.05, y: 0.05 })).toBe(false);
  });
});

describe("signedDistToRegion", () => {
  test("outside is positive, inside is negative", () => {
    const slice = regionValue([A, chord, B, alongValue(c, -1)], []);
    expect(signedDistToRegion(slice, { x: 0.2, y: 0.2 })).toBeGreaterThan(0);
    expect(signedDistToRegion(slice, { x: 1.4, y: 1.4 })).toBeLessThan(0);
  });
});

describe("profile holes", () => {
  test("a hole punches the interior and is not XOR", () => {
    const p = regionValue(rectCycle(0, 0, 1, 1), [rectCycle(0.25, 0.25, 0.75, 0.75)]);
    expect(p.holes).toHaveLength(1);
    expect(regionContains(p, { x: 0.1, y: 0.1 })).toBe(true);
    expect(regionContains(p, { x: 0.5, y: 0.5 })).toBe(false);
    expect(regionContains(p, { x: 1.5, y: 0.5 })).toBe(false);
    expect(signedDistToRegion(p, { x: 0.1, y: 0.1 })).toBeLessThan(0);
    expect(signedDistToRegion(p, { x: 0.5, y: 0.5 })).toBeGreaterThan(0);
    const d = regionSvgPath(p);
    expect(d.match(/Z/g)?.length).toBe(2);
  });

  test("an arc hole keeps A commands in the svg path", () => {
    const holeC: Circle = { kind: "circle", center: { x: 0.5, y: 0.5 }, radius: 0.2 };
    const P = { x: 0.3, y: 0.5 };
    const Q = { x: 0.7, y: 0.5 };
    const p = regionValue(rectCycle(0, 0, 1, 1), [[P, seg(P, Q), Q, alongValue(holeC, -1)]]);
    expect(p.holes).toHaveLength(1);
    expect(regionContains(p, { x: 0.08, y: 0.08 })).toBe(true);
    expect(regionContains(p, { x: 0.5, y: 0.4 })).toBe(false);
    expect(regionContains(p, { x: 0.5, y: 0.72 })).toBe(true);
    expect(regionSvgPath(p)).toMatch(/A /);
    expect(regionSvgPath(p).match(/Z/g)?.length).toBe(2);
  });

  test("a circle is a closed walk as a hole", () => {
    const hole: Circle = { kind: "circle", center: { x: 0.5, y: 0.5 }, radius: 0.2 };
    const p = regionValue(rectCycle(0, 0, 1, 1), [hole]);
    expect(p.holes).toHaveLength(1);
    expect(isCircleWalk(p.holes[0]!)).toBe(true);
    expect(regionContains(p, { x: 0.08, y: 0.08 })).toBe(true);
    expect(regionContains(p, { x: 0.5, y: 0.5 })).toBe(false);
    expect(regionSvgPath(p)).toMatch(/A /);
    expect(regionSvgPath(p).match(/Z/g)?.length).toBe(2);
  });

  test("a circle is a closed walk as the outer", () => {
    const p = regionValue({ kind: "circle", center: { x: 0, y: 0 }, radius: 1 }, []);
    expect(isCircleWalk(p.outer)).toBe(true);
    expect(regionContains(p, { x: 0, y: 0 })).toBe(true);
    expect(regionContains(p, { x: 0.5, y: 0 })).toBe(true);
    expect(regionContains(p, { x: 1.01, y: 0 })).toBe(false);
  });

  test("a hole outside the outer is an empty profile", () => {
    const p = regionValue(rectCycle(0, 0, 1, 1), [rectCycle(2, 2, 3, 3)]);
    expect(p.outer).toHaveLength(0);
    expect(p.holes).toHaveLength(0);
  });

  test("overlapping holes are empty", () => {
    const p = regionValue(rectCycle(0, 0, 2, 2), [
      rectCycle(0.2, 0.2, 1.1, 1.1),
      rectCycle(0.9, 0.9, 1.8, 1.8),
    ]);
    expect(p.outer).toHaveLength(0);
  });

  test("a hole nested in another hole is empty", () => {
    const p = regionValue(rectCycle(0, 0, 2, 2), [
      rectCycle(0.2, 0.2, 1.8, 1.8),
      rectCycle(0.6, 0.6, 1.4, 1.4),
    ]);
    expect(p.outer).toHaveLength(0);
  });

  test("a hole that crosses the outer is empty", () => {
    const p = regionValue(rectCycle(0, 0, 1, 1), [rectCycle(0.5, 0.5, 1.5, 1.5)]);
    expect(p.outer).toHaveLength(0);
  });

  test("roundOffset of a holed profile shrinks the hole when growing", () => {
    const p = regionValue(rectCycle(0, 0, 1, 1), [rectCycle(0.3, 0.3, 0.7, 0.7)]);
    const out = roundOffsetValue(p, 0.1);
    expect(out).toHaveLength(1);
    expect(out[0]?.holes).toHaveLength(1);
    expect(regionContains(out[0]!, { x: 0.08, y: 0.08 })).toBe(true);
    expect(regionContains(out[0]!, { x: 0.5, y: 0.5 })).toBe(false);
    expect(regionContains(out[0]!, { x: 0.35, y: 0.35 })).toBe(true);
  });
});
