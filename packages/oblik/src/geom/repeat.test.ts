import { describe, expect, test } from "vitest";

import {
  isFillGeom,
  isFinitePolarRepeat,
  operandAabb,
  operandSdf,
  polarRepeatValue,
  isCsgOperand,
  nanPolarRepeat,
  repeatAabb,
} from "./csg2";
import { evaluateRegions } from "./csg2";
import { stampRepeat, mergeRepeatOutline } from "./csg2";
import { foldPolar, repeatStep, rotateAbout, rotateRegion } from "./repeat";
import type { CsgOperand, LoopEdge, PolarRepeat, Region } from "./types";
import { dist } from "./vec";
import type { Vec2 } from "./vec";

/**
 * The polar repeat is a union of rotated copies that never expands: the field
 * folds the query point into the *nearest* copy and evaluates one copy there.
 * That is exact only under its precondition (`of` fits its `2π/count` sector,
 * copies disjoint), so the reference here is the naive union — brute-force min
 * over every copy's own distance — and the precondition is tested as a
 * precondition rather than assumed.
 */

const TAU = Math.PI * 2;

/** Axis-aligned box region at `+x`, sized so a ring of them stays disjoint. */
function boxRegion(cx: number, halfW: number, halfH: number): Region {
  const corners: Vec2[] = [
    { x: cx - halfW, y: -halfH },
    { x: cx + halfW, y: -halfH },
    { x: cx + halfW, y: halfH },
    { x: cx - halfW, y: halfH },
  ];
  const outer = corners.map((a, i) => {
    const b = corners[(i + 1) % corners.length]!;
    return { a, b, carrier: { kind: "segment" as const, a, b } };
  });
  return { kind: "region", outer, holes: [] };
}

/** Naive reference: the minimum distance over every copy, nothing folded.
 * `rotateAbout(p, about, ang)` turns `p` by `−ang`, which is exactly the change
 * of frame into the copy at `ang` — the same map the fold applies to pick its
 * copy, applied here to every copy in turn. */
function unionSdf(rep: PolarRepeat, p: Vec2): number {
  const step = repeatStep(rep.count);
  let d = Infinity;
  for (let k = 0; k < rep.count; k++) {
    d = Math.min(d, operandSdf(rep.of, rotateAbout(p, rep.about, rep.rotation + k * step)));
  }
  return d;
}

/** A ring of thin boxes, swept over a square that covers the whole pattern. */
function sweep(rep: PolarRepeat): { worst: number; at: Vec2 } {
  let worst = 0;
  let at: Vec2 = { x: 0, y: 0 };
  const span = 5;
  const n = 161;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const p = { x: -span + (2 * span * i) / (n - 1), y: -span + (2 * span * j) / (n - 1) };
      const slip = Math.abs(operandSdf(rep, p) - unionSdf(rep, p));
      if (slip > worst) {
        worst = slip;
        at = p;
      }
    }
  }
  return { worst, at };
}

describe("polarRepeat value", () => {
  const tooth = boxRegion(2, 0.2, 0.3);

  test("counts are rounded up to one, and a bad repeat is empty rather than broken", () => {
    expect(polarRepeatValue(tooth, 12.4, { x: 0, y: 0 }, 0).count).toBe(12);
    // A single copy is still a repeat: it is the child turned *by* `rotation`,
    // so the box at `+x` lands on `+y` and a probe on it is inside.
    const one = polarRepeatValue(tooth, 1, { x: 0, y: 0 }, Math.PI / 2);
    expect(one.count).toBe(1);
    expect(operandSdf(one, { x: 0, y: 2 })).toBeCloseTo(operandSdf(tooth, { x: 2, y: 0 }), 12);
    expect(operandSdf(one, { x: 0, y: 2 })).toBeCloseTo(-0.2, 9);
    // Degenerate inputs read as empty, like every other nan constructor.
    expect(isFinitePolarRepeat(polarRepeatValue(tooth, Number.NaN, { x: 0, y: 0 }, 0))).toBe(false);
    expect(isFinitePolarRepeat(nanPolarRepeat())).toBe(false);
    expect(operandSdf(nanPolarRepeat(), { x: 0, y: 0 })).toBeNaN();
  });

  test("it is a fill geometry and nests as a CSG operand", () => {
    const rep = polarRepeatValue(tooth, 12, { x: 0, y: 0 }, 0);
    expect(isFillGeom(rep)).toBe(true);
    expect(isCsgOperand(rep)).toBe(true);
    // Nested inside a boolean: the repeat's distance is the leaf's.
    const cut: CsgOperand = { kind: "circle", center: { x: 0, y: 0 }, radius: 0.5 };
    const diffed: CsgOperand = { kind: "csg2", op: "diff", of: [rep, cut] };
    expect(operandSdf(diffed, { x: 2, y: 0 })).toBeCloseTo(-0.2, 9);
  });
});

describe("the fold equals the union of its copies", () => {
  test("a tooth that fits its sector agrees with the brute-force minimum", () => {
    // 12 copies, each ~0.3 world units wide at radius 2: the angular half-width
    // (~0.15 rad) is well inside the 0.26 rad half-sector.
    const rep = polarRepeatValue(boxRegion(2, 0.2, 0.3), 12, { x: 0, y: 0 }, 0.4);
    const { worst, at } = sweep(rep);
    expect(worst, `worst slip at ${JSON.stringify(at)}`).toBeLessThan(1e-9);
    // A second configuration: odd count, negative spin.
    expect(
      sweep(polarRepeatValue(boxRegion(2, 0.2, 0.3), 7, { x: 0, y: 0 }, -1.1)).worst,
    ).toBeLessThan(1e-9);
    // And the general case — an axis away from the origin, the tooth authored
    // unrotated on that axis's `+x` side, the ring spun by `rotation`. This is
    // the shape a real gear takes.
    const about = { x: 0.3, y: -0.2 };
    const placed = offsetRegion(boxRegion(2, 0.2, 0.3), about);
    expect(sweep(polarRepeatValue(placed, 9, about, 0.7)).worst).toBeLessThan(1e-9);
    expect(sweep(polarRepeatValue(placed, 9, about, -2.4)).worst).toBeLessThan(1e-9);
  });

  test("the fold is exact for the cell it assumes, and only for that", () => {
    // The fold resolves a probe to `round((θ − rotation)/step)`: it assumes the
    // copy's centreline *is* the cell's centreline. Two ways to break that, both
    // authoring mistakes rather than renderer bugs.
    //
    // 1. A body authored 20° round its own ring: the fold and the stamped union
    //    only agree when the copy sits where `rotation` says it does.
    const offCentre = polarRepeatValue(
      rotateRegion(boxRegion(2, 0.2, 0.3), { x: 0, y: 0 }, -0.35),
      12,
      { x: 0, y: 0 },
      0,
    );
    expect(sweep(offCentre).worst).toBeGreaterThan(0.05);
    // 2. A body reaching past its cell edge (90° cells; the copy's far corner sits
    //    at 48°): the nearest copy by angle is then not always the nearest by
    //    distance, so the fold can pick the wrong copy.
    const tooWide = polarRepeatValue(boxRegion(1, 0.8, 2), 4, { x: 0, y: 0 }, 0);
    expect(sweep(tooWide).worst).toBeGreaterThan(0.05);
    // 3. A body that straddles the axis instead of sitting out on its cell: its
    //    distance profile is not a function of `|Δθ|` at all, so the angular fold
    //    has nothing to be right about.
    const straddling = polarRepeatValue(boxRegion(0, 0.2, 0.3), 9, { x: 0, y: 0 }, 0);
    expect(sweep(straddling).worst).toBeGreaterThan(0.05);
    // Both shapes inside their cells are exact to the last bit, so what decides
    // is the authoring, not the shape.
    expect(
      sweep(polarRepeatValue(boxRegion(2, 0.2, 0.3), 12, { x: 0, y: 0 }, 0)).worst,
    ).toBeLessThan(1e-9);
    expect(
      sweep(polarRepeatValue(boxRegion(1, 0.8, 0.9), 4, { x: 0, y: 0 }, 0)).worst,
    ).toBeLessThan(1e-9);
  });

  test("the fold is the same map the twin calls", () => {
    const rep = polarRepeatValue(boxRegion(2, 0.2, 0.3), 8, { x: 0, y: 0 }, 0.1);
    const p = { x: 1.7, y: 0.9 };
    const folded = foldPolar(p, rep.about, rep.rotation, repeatStep(rep.count));
    // `foldPolar` returns the point in the nearest copy's frame, so the child's
    // own distance there is the repeat's distance at `p`.
    expect(operandSdf(rep, p)).toBeCloseTo(operandSdf(rep.of, folded), 12);
  });
});

describe("geometry side: the copies are stamped, not folded", () => {
  test("evaluateRegions resolves one island per copy, turned about the axis", () => {
    const rep = polarRepeatValue(boxRegion(2, 0.2, 0.3), 6, { x: 0, y: 0 }, Math.PI / 2);
    const islands = evaluateRegions(rep);
    expect(islands).toHaveLength(6);
    // Copy k sits at rotation + k·step: with a quarter-turn spin, copy 1 is the
    // box on -y (the child's +x point turned 90° + 60°).
    const step = TAU / 6;
    const box = operandAabb(rep.of)!;
    for (let k = 0; k < 6; k++) {
      const ang = Math.PI / 2 + k * step;
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      const want = { x: 2 * c, y: 2 * s };
      const box2 = regionAabbOf(islands[k]!);
      expect(box2.x).toBeCloseTo(want.x, 9);
      expect(box2.y).toBeCloseTo(want.y, 9);
    }
    expect(box.maxX).toBeCloseTo(2.2, 9);
  });

  test("rotating a region keeps its carriers honest", () => {
    const ring: Region = {
      kind: "region",
      outer: {
        kind: "circle",
        center: { x: 2, y: 0 },
        radius: 0.4,
      },
      holes: [],
    };
    const turned = rotateRegion(ring, { x: 0, y: 0 }, Math.PI / 2);
    expect(turned.outer).toMatchObject({ kind: "circle", radius: 0.4 });
    const c = (turned.outer as { center: Vec2 }).center;
    expect(c.x).toBeCloseTo(0, 9);
    expect(c.y).toBeCloseTo(2, 9);
  });

  test("the repeat's box covers every copy", () => {
    const rep = polarRepeatValue(boxRegion(2, 0.2, 0.3), 12, { x: 0, y: 0 }, 0);
    const box = repeatAabb(rep)!;
    // The child's own box is 2±0.2 × ±0.3, so the ring's box is ±2.2 in x and
    // ±(2.2·sin(30°)+0.3·cos) in y — bounded by the disc through the corners.
    expect(box.maxX).toBeCloseTo(2.2, 9);
    expect(box.minX).toBeCloseTo(-2.2, 6);
    expect(box.maxY).toBeLessThanOrEqual(Math.hypot(2.2, 0.3) + 1e-9);
    expect(box.maxY).toBeGreaterThan(1);
    expect(operandAabb(rep)).toEqual(box);
  });
});

/** The same child authored about an axis away from the origin: cell 0 is the
 * `+x` side of `about`, unrotated — what `polarRepeat` expects. */
function offsetRegion(region: Region, about: Vec2): Region {
  const shift = (p: Vec2): Vec2 => ({ x: p.x + about.x, y: p.y + about.y });
  return {
    kind: "region",
    outer: (region.outer as { a: Vec2; b: Vec2 }[]).map((e) => {
      const a = shift(e.a);
      const b = shift(e.b);
      return { a, b, carrier: { kind: "segment" as const, a, b } };
    }),
    holes: [],
  };
}

/** Centre of an island's loop (test-local: the boxes here are symmetric). */
function regionAabbOf(r: Region): Vec2 {
  const loop = r.outer;
  if (!Array.isArray(loop)) return loop.center;
  let x = 0;
  let y = 0;
  for (const e of loop) {
    x += e.a.x;
    y += e.a.y;
  }
  return { x: x / loop.length, y: y / loop.length };
}

describe("the copies' union outline", () => {
  /** A cell that tiles: a sector of the disc, with radial edges to the axis —
   * the gear cell's shape, and the one whose seams have to disappear. */
  function sectorCell(count: number, halfTurn = 0): Region {
    const step = TAU / count;
    const half = step / 2;
    const radius = 2;
    const at = (ang: number): Vec2 => ({ x: radius * Math.cos(ang), y: radius * Math.sin(ang) });
    const edges: LoopEdge[] = [];
    const samples = 4;
    for (let i = 0; i < samples; i++) {
      const a0 = -half + (2 * half * i) / samples;
      const a1 = -half + (2 * half * (i + 1)) / samples;
      edges.push({
        a: at(a0),
        b: at(a1),
        carrier: { kind: "circle", center: { x: 0, y: 0 }, radius },
        k: 1,
      });
    }
    // Out to the axis and back: exactly the two edges the neighbours share.
    edges.push({
      a: at(half),
      b: { x: 0, y: 0 },
      carrier: { kind: "segment", a: at(half), b: { x: 0, y: 0 } },
    });
    edges.push({
      a: { x: 0, y: 0 },
      b: at(-half),
      carrier: { kind: "segment", a: { x: 0, y: 0 }, b: at(-half) },
    });
    void halfTurn;
    return { kind: "region", outer: edges, holes: [] };
  }

  test("tiling cells merge into one ring loop, with the seams gone", () => {
    const rep = polarRepeatValue(sectorCell(12), 12, { x: 0, y: 0 }, 0);
    expect(stampRepeat(rep)).toHaveLength(12);
    const merged = mergeRepeatOutline(rep);
    // One loop for the whole ring: the radial seams were shared, so they are
    // interior, and the surviving edges chain copy to copy.
    expect(merged).toHaveLength(1);
    const loop = merged[0]!.outer as LoopEdge[];
    const radial = loop.filter((e) => Math.abs(e.a.x * e.b.y - e.a.y * e.b.x) < 1e-9);
    expect(radial).toHaveLength(0);
    // Every copy's arc survives: 12 × 4 arc edges, and nothing else.
    expect(loop).toHaveLength(48);
    expect(loop.every((e) => e.carrier.kind === "circle")).toBe(true);
    // Each surviving edge continues from the one before it — one continuous loop.
    for (let i = 1; i < loop.length; i++) {
      expect(dist(loop[i]!.a, loop[i - 1]!.b)).toBeLessThan(1e-9);
    }
  });

  test("copies that share nothing stay one island each", () => {
    const rep = polarRepeatValue(boxRegion(2, 0.2, 0.3), 6, { x: 0, y: 0 }, 0);
    const merged = mergeRepeatOutline(rep);
    expect(merged).toHaveLength(6);
    expect(merged.every((island) => Array.isArray(island.outer))).toBe(true);
  });
});
