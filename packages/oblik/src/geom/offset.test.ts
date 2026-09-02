import { describe, expect, test } from "vitest";

import { pointOnCircleValue } from "./gliders";
import { filletAtVertex, localOffset, regionCorners, roundOffsetValue } from "./offset";
import {
  alongValue,
  filletValue,
  isCircleWalk,
  regionContains,
  regionValue,
  walkEdges,
} from "./region";
import type { Circle, Region, Segment } from "./types";
import type { Vec2 } from "./vec";

function poly(pts: readonly Vec2[]): Region {
  const cycle: unknown[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    cycle.push(a, { kind: "segment", a, b } satisfies Segment);
  }
  return regionValue(cycle, []);
}

function seg(a: Vec2, b: Vec2): Segment {
  return { kind: "segment", a, b };
}

function rectCycle(x0: number, y0: number, x1: number, y1: number): unknown[] {
  const bl = { x: x0, y: y0 };
  const br = { x: x1, y: y0 };
  const tr = { x: x1, y: y1 };
  const tl = { x: x0, y: y1 };
  return [bl, seg(bl, br), br, seg(br, tr), tr, seg(tr, tl), tl, seg(tl, bl)];
}

function twoArcCircle(center: Vec2, r: number, k: 1 | -1 = 1): unknown[] {
  const P = { x: center.x + r, y: center.y };
  const Q = { x: center.x - r, y: center.y };
  const c: Circle = { kind: "circle", center, radius: r };
  return [P, alongValue(c, k), Q, alongValue(c, k)];
}

function twoHoles(web: number): Region {
  const a1 = 0.5;
  const a2 = 1.9;
  const b1 = a2 + web;
  const b2 = b1 + 1.4;
  return regionValue(rectCycle(0, 0, 4, 2), [
    rectCycle(a1, 0.4, a2, 1.6),
    rectCycle(b1, 0.4, b2, 1.6),
  ]);
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
const slice = regionValue([A, chord, B, alongValue(reach, -1)], []);

function roundedSquare(r: number): Region {
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
  return regionValue(cycle, []);
}

function sector(deg: number): Region {
  const r = 2;
  const a = (deg * Math.PI) / 180;
  const O = { x: 0, y: 0 };
  const P = { x: r, y: 0 };
  const Q = { x: r * Math.cos(a), y: r * Math.sin(a) };
  const oa: Segment = { kind: "segment", a: O, b: P };
  const ob: Segment = { kind: "segment", a: O, b: Q };
  const c: Circle = { kind: "circle", center: O, radius: r };
  return regionValue([O, oa, P, alongValue(c, 1), Q, ob], []);
}

describe("roundOffsetValue", () => {
  test("d === 0 is a copy", () => {
    const out = roundOffsetValue(square, 0);
    expect(out).toHaveLength(1);
    expect(out[0]?.outer).toHaveLength(4);
    expect(out[0]).not.toBe(square);
    expect(regionContains(out[0]!, { x: 0.5, y: 0.5 })).toBe(true);
  });

  test("CCW square inset miters to four edges", () => {
    const out = roundOffsetValue(square, -0.2);
    expect(out).toHaveLength(1);
    const p = out[0]!;
    expect(p.outer).toHaveLength(4);
    expect(walkEdges(p.outer).every((e) => e.carrier.kind !== "circle")).toBe(true);
    expect(regionContains(p, { x: 0.5, y: 0.5 })).toBe(true);
    expect(regionContains(p, { x: 1, y: 1 })).toBe(false);
    expect(regionContains(p, { x: 0.05, y: 0.05 })).toBe(false);
    expect(walkEdges(p.outer)[0]?.a.x).toBeCloseTo(0.2);
    expect(walkEdges(p.outer)[0]?.a.y).toBeCloseTo(0.2);
    expect(walkEdges(p.outer)[0]?.b.x).toBeCloseTo(0.8);
    expect(walkEdges(p.outer)[0]?.b.y).toBeCloseTo(0.2);
  });

  test("CCW square outset is four offsets plus four quarter joins", () => {
    const out = roundOffsetValue(square, 0.2);
    expect(out).toHaveLength(1);
    const p = out[0]!;
    expect(p.outer).toHaveLength(8);
    expect(walkEdges(p.outer).filter((e) => e.carrier.kind === "circle")).toHaveLength(4);
    expect(
      walkEdges(p.outer)
        .filter((e) => e.carrier.kind === "circle")
        .every((e) => e.k === 1),
    ).toBe(true);
    expect(regionContains(p, { x: 0.5, y: 0.5 })).toBe(true);
    expect(regionContains(p, { x: 1, y: 1 })).toBe(true);
    expect(regionContains(p, { x: 1.1, y: 0.5 })).toBe(true);
    expect(regionContains(p, { x: 1.1, y: 1.1 })).toBe(true);
    expect(regionContains(p, { x: 1.2, y: 1.2 })).toBe(false);
  });

  test("square inset past half-side collapses", () => {
    expect(roundOffsetValue(square, -0.5)).toEqual([]);
    expect(roundOffsetValue(square, -0.6)).toEqual([]);
  });

  test("slice inset keeps a point in the cap; large |d| empties", () => {
    const small = roundOffsetValue(slice, -0.12);
    expect(small).toHaveLength(1);
    expect(small[0]?.outer).toHaveLength(2);
    expect(regionContains(small[0]!, { x: 1.25, y: 1.25 })).toBe(true);
    expect(regionContains(small[0]!, { x: 0.2, y: 0.2 })).toBe(false);
    expect(roundOffsetValue(slice, -0.5)).toEqual([]);
  });

  test("180° sector inset offsets the diameter instead of missing the miter", () => {
    const out = roundOffsetValue(sector(180), -0.12);
    expect(out).toHaveLength(1);
    const p = out[0]!;
    expect(p.outer).toHaveLength(3);
    expect(walkEdges(p.outer).filter((e) => e.carrier.kind === "circle")).toHaveLength(1);
    expect(regionContains(p, { x: 0, y: 1 })).toBe(true);
    expect(regionContains(p, { x: 0, y: 0 })).toBe(false);
    expect(regionContains(p, { x: 0, y: 0.05 })).toBe(false);
    expect(walkEdges(p.outer)[0]?.a.y).toBeCloseTo(0.12);
    expect(walkEdges(p.outer)[0]?.b.y).toBeCloseTo(0.12);
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
    expect(walkEdges(p.outer).filter((e) => e.carrier.kind === "circle")).toHaveLength(2);
    expect(regionContains(p, { x: 0.4, y: 0.4 })).toBe(true);
    expect(regionContains(p, { x: 0, y: 0 })).toBe(false);
  });

  test("slice outset rounds the tips", () => {
    const out = roundOffsetValue(slice, 0.15);
    expect(out).toHaveLength(1);
    expect(out[0]?.outer).toHaveLength(4);
    expect(walkEdges(out[0]?.outer ?? []).filter((e) => e.carrier.kind === "circle")).toHaveLength(
      3,
    );
    expect(regionContains(out[0]!, { x: 1.4, y: 1.4 })).toBe(true);
  });

  test("filleted square inset past r drops the arcs and keeps a sharp inner square", () => {
    const face = roundedSquare(0.05);
    expect(face.outer).toHaveLength(8);
    const out = roundOffsetValue(face, -0.12);
    expect(out).toHaveLength(1);
    const p = out[0]!;
    expect(p.outer).toHaveLength(4);
    expect(walkEdges(p.outer).every((e) => e.carrier.kind !== "circle")).toBe(true);
    expect(regionContains(p, { x: 0.5, y: 0.5 })).toBe(true);
    expect(regionContains(p, { x: 0.05, y: 0.05 })).toBe(false);
    expect(walkEdges(p.outer)[0]?.a.x).toBeCloseTo(0.12);
    expect(walkEdges(p.outer)[0]?.a.y).toBeCloseTo(0.12);
  });

  test("filleted square inset at d === r is the same sharp remnant", () => {
    const out = roundOffsetValue(roundedSquare(0.12), -0.12);
    expect(out).toHaveLength(1);
    const p = out[0]!;
    expect(p.outer).toHaveLength(4);
    expect(walkEdges(p.outer).every((e) => e.carrier.kind !== "circle")).toBe(true);
    expect(regionContains(p, { x: 0.5, y: 0.5 })).toBe(true);
    expect(regionContains(p, { x: 0.05, y: 0.05 })).toBe(false);
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
    const face = regionValue(cycle, []);
    expect(face.outer).toHaveLength(5);
    const out = roundOffsetValue(face, -0.12);
    expect(out).toHaveLength(1);
    const p = out[0]!;
    expect(p.outer).toHaveLength(4);
    expect(walkEdges(p.outer).every((e) => e.carrier.kind !== "circle")).toBe(true);
    expect(regionContains(p, { x: 0.5, y: 0.5 })).toBe(true);
    expect(regionContains(p, { x: 0.05, y: 0.05 })).toBe(false);
  });

  test("filleted square inset shallower than r keeps the rounded corners", () => {
    const out = roundOffsetValue(roundedSquare(0.2), -0.1);
    expect(out).toHaveLength(1);
    const p = out[0]!;
    expect(p.outer).toHaveLength(8);
    expect(walkEdges(p.outer).filter((e) => e.carrier.kind === "circle")).toHaveLength(4);
    expect(regionContains(p, { x: 0.5, y: 0.5 })).toBe(true);
    expect(regionContains(p, { x: 0.12, y: 0.12 })).toBe(false);
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
    const arcs = walkEdges(out[0]!.outer).filter((e) => e.carrier.kind === "circle");
    expect(out[0]?.outer).toHaveLength(7);
    expect(arcs).toHaveLength(1);
    expect(arcs[0]?.carrier.kind === "circle" && arcs[0].carrier.center.x).toBeCloseTo(1);
    expect(arcs[0]?.carrier.kind === "circle" && arcs[0].carrier.center.y).toBeCloseTo(1);
    expect(regionContains(out[0]!, { x: 0.4, y: 0.4 })).toBe(true);
    expect(regionContains(out[0]!, { x: 1.5, y: 1.5 })).toBe(false);
  });

  test("growing a filleted ice-cream keeps a remnant when r' is a sliver", () => {
    const O = { x: 3.69, y: 9.11 };
    const c: Circle = { kind: "circle", center: O, radius: 0.41 };
    const g = pointOnCircleValue(c, -0.52, 0.85);
    const g2 = pointOnCircleValue(c, 0.51, 0.86);
    const tip = { x: 3.76, y: 10.12 };
    const left: Segment = { kind: "segment", a: { x: g.x, y: g.y }, b: tip };
    const right: Segment = { kind: "segment", a: tip, b: { x: g2.x, y: g2.y } };
    const face = regionValue(
      [
        tip,
        left,
        filletValue({ x: g.x, y: g.y }, 0.36),
        alongValue(c, 1),
        filletValue({ x: g2.x, y: g2.y }, 0.36),
        right,
      ],
      [],
    );
    expect(walkEdges(face.outer).length).toBe(5);
    const out = roundOffsetValue(face, 0.359);
    expect(out).toHaveLength(1);
    const p = out[0]!;
    expect(walkEdges(p.outer).length).toBeGreaterThanOrEqual(4);
    expect(regionContains(p, O)).toBe(true);
    expect(regionContains(p, { x: 3.69, y: 8.61 })).toBe(true);
    expect(regionContains(p, { x: 3.69, y: 8.2 })).toBe(false);
  });

  test("a swapped kernel is what roundOffsetValue runs", () => {
    const stub = () => [square];
    expect(roundOffsetValue(square, -0.2, stub)).toEqual([square]);
  });

  test("localOffset matches envelope on a convex inset", () => {
    const a = localOffset(square, -0.2);
    const b = roundOffsetValue(square, -0.2);
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(walkEdges(a[0]?.outer ?? [])).toHaveLength(walkEdges(b[0]!.outer).length);
    expect(regionContains(b[0]!, { x: 0.5, y: 0.5 })).toBe(true);
  });

  test("a dogbone inset past the neck splits into two islands", () => {
    const bone = poly([
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 0.8 },
      { x: 3, y: 0.8 },
      { x: 3, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 2 },
      { x: 3, y: 2 },
      { x: 3, y: 1.2 },
      { x: 2, y: 1.2 },
      { x: 2, y: 2 },
      { x: 0, y: 2 },
    ]);
    const connected = roundOffsetValue(bone, -0.1);
    expect(connected).toHaveLength(1);
    expect(regionContains(connected[0]!, { x: 1, y: 1 })).toBe(true);
    expect(regionContains(connected[0]!, { x: 4, y: 1 })).toBe(true);
    expect(regionContains(connected[0]!, { x: 2.5, y: 1 })).toBe(true);

    const split = roundOffsetValue(bone, -0.3);
    expect(split).toHaveLength(2);
    const left = split.find((p) => regionContains(p, { x: 1, y: 1 }));
    const right = split.find((p) => regionContains(p, { x: 4, y: 1 }));
    expect(left).toBeTruthy();
    expect(right).toBeTruthy();
    expect(left).not.toBe(right);
    expect(regionContains(left!, { x: 2.5, y: 1 })).toBe(false);
    expect(regionContains(right!, { x: 2.5, y: 1 })).toBe(false);
    const remnant = localOffset(bone, -0.3);
    expect(remnant).toHaveLength(1);
    expect(regionContains(remnant[0]!, { x: 2.5, y: 1 })).toBe(true);
  });

  test("outset of a U closes the bay into one outer", () => {
    const u = poly([
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 3 },
      { x: 2, y: 3 },
      { x: 2, y: 1 },
      { x: 1, y: 1 },
      { x: 1, y: 3 },
      { x: 0, y: 3 },
    ]);
    const open = roundOffsetValue(u, 0.2);
    expect(open).toHaveLength(1);
    expect(regionContains(open[0]!, { x: 1.5, y: 2 })).toBe(false);

    const closed = roundOffsetValue(u, 0.6);
    expect(closed).toHaveLength(1);
    expect(closed[0]?.holes).toHaveLength(0);
    expect(regionContains(closed[0]!, { x: 1.5, y: 0.5 })).toBe(true);
    expect(regionContains(closed[0]!, { x: 1.5, y: 2 })).toBe(true);
    expect(regionContains(closed[0]!, { x: 1.5, y: 3.7 })).toBe(false);
  });

  test("two-hole inset keeps a void when the web pinches", () => {
    const p = twoHoles(0.4);
    expect(p.holes).toHaveLength(2);

    const shallow = roundOffsetValue(p, -0.12);
    expect(shallow).toHaveLength(1);
    expect(shallow[0]?.holes).toHaveLength(2);
    expect(regionContains(shallow[0]!, { x: 0.2, y: 1 })).toBe(true);
    expect(regionContains(shallow[0]!, { x: 1.2, y: 1 })).toBe(false);
    expect(regionContains(shallow[0]!, { x: 2.1, y: 1 })).toBe(true);

    for (const d of [-0.2, -0.25] as const) {
      const out = roundOffsetValue(p, d);
      const meat =
        d === -0.2
          ? out.some((q) => regionContains(q, { x: 0.2, y: 1 }))
          : out.some(
              (q) =>
                regionContains(q, { x: 0.26, y: 0.27 }) || regionContains(q, { x: 0.26, y: 1.73 }),
            );
      expect(meat).toBe(true);
      expect(out.some((q) => regionContains(q, { x: 1.2, y: 1 }))).toBe(false);
      expect(out.some((q) => regionContains(q, { x: 3, y: 1 }))).toBe(false);
      expect(out.some((q) => regionContains(q, { x: 2.1, y: 1 }))).toBe(false);
    }
  });

  test("playground two-hole plate at -0.2 keeps the voids", () => {
    const holes = [rectCycle(7.7, 4.15, 9.15, 5.45), rectCycle(9.55, 4.15, 11.0, 5.45)];
    const reported = roundOffsetValue(regionValue(rectCycle(7.2, 3.5, 11.4, 6.1), holes), -0.2);
    expect(reported.length).toBeGreaterThan(0);
    expect(reported.some((q) => regionContains(q, { x: 7.45, y: 4.8 }))).toBe(true);
    expect(reported.some((q) => regionContains(q, { x: 8.4, y: 4.8 }))).toBe(false);
    expect(reported.some((q) => regionContains(q, { x: 10.3, y: 4.8 }))).toBe(false);
    expect(reported.some((q) => regionContains(q, { x: 9.35, y: 4.8 }))).toBe(false);

    const scene = roundOffsetValue(regionValue(rectCycle(7.2, 3.5, 11.8, 6.1), holes), -0.2);
    expect(scene).toHaveLength(1);
    expect(scene[0]?.holes.length).toBeGreaterThan(0);
    expect(regionContains(scene[0]!, { x: 7.45, y: 4.8 })).toBe(true);
    expect(regionContains(scene[0]!, { x: 11.4, y: 4.8 })).toBe(true);
    expect(regionContains(scene[0]!, { x: 8.4, y: 4.8 })).toBe(false);
    expect(regionContains(scene[0]!, { x: 10.3, y: 4.8 })).toBe(false);
    expect(regionContains(scene[0]!, { x: 9.35, y: 4.8 })).toBe(false);
  });

  test("two-arc circular hole stays a hole under inset and outset", () => {
    const center = { x: 13.7, y: 4.8 };
    const p = regionValue(rectCycle(12.2, 3.5, 15.2, 6.1), [twoArcCircle(center, 0.52)]);
    expect(p.holes).toHaveLength(1);

    for (const d of [-0.12, -0.01, 0.12] as const) {
      const out = roundOffsetValue(p, d);
      expect(out).toHaveLength(1);
      expect(out[0]?.holes).toHaveLength(1);
      expect(regionContains(out[0]!, { x: 12.4, y: 3.7 })).toBe(true);
      expect(regionContains(out[0]!, center)).toBe(false);
    }
  });

  test("circle hole stays a concentric circle under inset and outset", () => {
    const center = { x: 13.7, y: 4.8 };
    const hole: Circle = { kind: "circle", center, radius: 0.52 };
    const p = regionValue(rectCycle(12.2, 3.5, 15.2, 6.1), [hole]);
    expect(isCircleWalk(p.holes[0]!)).toBe(true);

    for (const d of [-0.12, -0.01, 0.12] as const) {
      const out = roundOffsetValue(p, d);
      expect(out).toHaveLength(1);
      expect(out[0]?.holes).toHaveLength(1);
      const h = out[0]!.holes[0]!;
      if (!isCircleWalk(h)) throw new Error("expected circle hole");
      expect(h.radius).toBeCloseTo(0.52 - d);
      expect(h.center.x).toBeCloseTo(center.x);
      expect(h.center.y).toBeCloseTo(center.y);
      expect(regionContains(out[0]!, { x: 12.4, y: 3.7 })).toBe(true);
      expect(regionContains(out[0]!, center)).toBe(false);
    }
  });

  test("circle outer insets to a concentric circle", () => {
    const out = roundOffsetValue(
      regionValue({ kind: "circle", center: { x: 0, y: 0 }, radius: 1 }, []),
      -0.2,
    );
    expect(out).toHaveLength(1);
    const disk = out[0]!.outer;
    if (!isCircleWalk(disk)) throw new Error("expected circle outer");
    expect(disk.radius).toBeCloseTo(0.8);
    expect(regionContains(out[0]!, { x: 0, y: 0 })).toBe(true);
    expect(regionContains(out[0]!, { x: 0.9, y: 0 })).toBe(false);
    expect(regionContains(out[0]!, { x: 0.7, y: 0 })).toBe(true);
  });

  test("two-arc circular disk insets to a smaller disk", () => {
    const out = roundOffsetValue(regionValue(twoArcCircle({ x: 0, y: 0 }, 1), []), -0.2);
    expect(out).toHaveLength(1);
    expect(out[0]?.holes).toHaveLength(0);
    expect(regionContains(out[0]!, { x: 0, y: 0 })).toBe(true);
    expect(regionContains(out[0]!, { x: 0.9, y: 0 })).toBe(false);
    expect(regionContains(out[0]!, { x: 0.7, y: 0 })).toBe(true);
  });

  test("a washer offsets as two concentric circles", () => {
    const p = regionValue({ kind: "circle", center: { x: 0, y: 0 }, radius: 2 }, [
      { kind: "circle", center: { x: 0, y: 0 }, radius: 0.8 },
    ]);
    expect(regionContains(p, { x: 1.2, y: 0 })).toBe(true);
    expect(regionContains(p, { x: 0, y: 0 })).toBe(false);
    const out = roundOffsetValue(p, -0.2);
    expect(out).toHaveLength(1);
    const outer = out[0]!.outer;
    const inner = out[0]!.holes[0]!;
    if (!isCircleWalk(outer) || !isCircleWalk(inner)) throw new Error("expected circle washer");
    expect(outer.radius).toBeCloseTo(1.8);
    expect(inner.radius).toBeCloseTo(1);
  });
});

describe("regionCorners / filletAtVertex", () => {
  test("sharp square corners sit on the four vertices", () => {
    const corners = regionCorners(square);
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
    const corners = regionCorners(face);
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
    expect(walkEdges(out.outer).filter((e) => e.carrier.kind === "circle")).toHaveLength(1);
    expect(regionContains(out, { x: 0.5, y: 0.5 })).toBe(true);
    expect(regionContains(out, { x: 0.05, y: 0.05 })).toBe(false);
    expect(regionContains(out, { x: 0.95, y: 0.95 })).toBe(true);
  });

  test("filletAtVertex r === 0 on a filleted corner is sharp again", () => {
    const out = filletAtVertex(roundedSquare(0.2), 0, 0);
    expect(regionContains(out, { x: 0.05, y: 0.05 })).toBe(true);
    expect(walkEdges(out.outer).filter((e) => e.carrier.kind === "circle")).toHaveLength(3);
  });

  test("too-large filletAtVertex is empty", () => {
    expect(filletAtVertex(square, 0, 1.1).outer).toHaveLength(0);
    expect(filletAtVertex(square, 0, -0.2).outer).toHaveLength(0);
  });

  test("a pie along rim is not skipped as a join", () => {
    const corners = regionCorners(sector(90));
    expect(corners).toHaveLength(3);
    expect(corners.every((c) => c.r === 0)).toBe(true);
  });

  test("a stadium semicircle is not skipped as a join", () => {
    const ptA = { x: 0, y: 0 };
    const ptB = { x: 2, y: 0 };
    const C = { x: 2, y: 1 };
    const D = { x: 0, y: 1 };
    const bot: Segment = { kind: "segment", a: ptA, b: ptB };
    const top: Segment = { kind: "segment", a: C, b: D };
    const cR: Circle = { kind: "circle", center: { x: 2, y: 0.5 }, radius: 0.5 };
    const cL: Circle = { kind: "circle", center: { x: 0, y: 0.5 }, radius: 0.5 };
    const face = regionValue([ptB, alongValue(cR, 1), C, top, D, alongValue(cL, 1), ptA, bot], []);
    expect(face.outer).toHaveLength(4);
    const corners = regionCorners(face);
    expect(corners).toHaveLength(4);
    expect(corners.every((c) => c.r === 0)).toBe(true);
  });
});
