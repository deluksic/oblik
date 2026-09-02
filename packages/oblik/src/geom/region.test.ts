import { describe, expect, test } from "vitest";

import { alongValue, filletValue, profileContains, profileSvgPath, profileValue } from "./profile";
import {
  compileRegion,
  distToRegion,
  formulaSdf,
  leftOfValue,
  regionContains,
  regionSvgPath,
  regionValue,
  rightOfValue,
} from "./region";
import { regionPaint, REGION_MASK } from "./region-draw";
import type { Circle, Line, Profile, Segment } from "./types";
import type { Vec2 } from "./vec";

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

function rect(x0: number, y0: number, x1: number, y1: number): Profile {
  return profileValue(rectCycle(x0, y0, x1, y1));
}

function disk(cx: number, cy: number, r: number): Circle {
  return { kind: "circle", center: { x: cx, y: cy }, radius: r };
}

function stadium(cx: number, cy: number, length: number, width: number): Profile {
  const r = width / 2;
  const half = Math.max(length, width) / 2 - r;
  const L = { x: cx - half, y: cy };
  const R = { x: cx + half, y: cy };
  const leftC: Circle = { kind: "circle", center: L, radius: r };
  const rightC: Circle = { kind: "circle", center: R, radius: r };
  const P = { x: L.x, y: L.y + r };
  const Q = { x: R.x, y: R.y + r };
  const botR = { x: R.x, y: R.y - r };
  const T = { x: L.x, y: L.y - r };
  return profileValue([
    P,
    seg(P, Q),
    Q,
    alongValue(rightC, -1),
    botR,
    seg(botR, T),
    T,
    alongValue(leftC, -1),
  ]);
}

const split: Line = { kind: "line", origin: { x: 2, y: 0 }, direction: { x: 0, y: 1 } };

describe("stadium profile", () => {
  test("outer caps with along(-1) wind as a filled slot", () => {
    const slot = stadium(0, 0, 2, 0.8);
    expect(slot.outer).toHaveLength(4);
    expect(profileContains(slot, { x: 0, y: 0 })).toBe(true);
    expect(profileContains(slot, { x: 0.9, y: 0 })).toBe(true);
    expect(profileContains(slot, { x: 0, y: 0.5 })).toBe(false);
  });
});

describe("profile as region stock", () => {
  test("swiss-cheese stock keeps the hole in the CSG field", () => {
    const plate = profileValue(rectCycle(0, 0, 2, 2), {
      holes: [rectCycle(0.6, 0.6, 1.4, 1.4)],
    });
    const face = regionValue(plate);
    expect(regionContains(face, { x: 0.2, y: 0.2 })).toBe(true);
    expect(regionContains(face, { x: 1, y: 1 })).toBe(false);
    expect(formulaSdf(face, { x: 1, y: 1 })).toBeGreaterThan(0);
    const paint = regionPaint(face);
    const d = paint.stock.kind === "profile" ? paint.stock.d : "";
    expect(paint.stock.kind).toBe("profile");
    expect(d.match(/Z/g)?.length).toBe(2);
  });
});

describe("region CSG field", () => {
  test("square minus interior disk has a hole", () => {
    const face = regionValue(rect(0, 0, 2, 2), { subtract: disk(1, 1, 0.4) });
    expect(formulaSdf(face, { x: 0.15, y: 0.15 })).toBeLessThan(0);
    expect(formulaSdf(face, { x: 1, y: 1 })).toBeGreaterThan(0);
    expect(regionContains(face, { x: 0.15, y: 0.15 })).toBe(true);
    expect(regionContains(face, { x: 1, y: 1 })).toBe(false);
    expect(distToRegion(face, { x: 0.15, y: 0.15 })).toBe(0);
    expect(compileRegion(face).length).toBeGreaterThanOrEqual(2);
  });

  test("escaping disk does not XOR a cap outside the stock", () => {
    const face = regionValue(rect(0, 0, 2, 2), { subtract: disk(2.2, 1, 0.5) });
    expect(regionContains(face, { x: 1, y: 1 })).toBe(true);
    expect(regionContains(face, { x: 2.2, y: 1 })).toBe(false);
    expect(formulaSdf(face, { x: 2.2, y: 1 })).toBeGreaterThan(0);
  });

  test("slot that severs yields two islands; contains keeps one", () => {
    const stock = rect(0, 0, 4, 2);
    const slot = stadium(2, 1, 5, 0.35);
    const face = regionValue(stock, { subtract: slot });
    expect(regionContains(face, { x: 2, y: 1.7 })).toBe(true);
    expect(regionContains(face, { x: 2, y: 0.3 })).toBe(true);
    expect(regionContains(face, { x: 2, y: 1 })).toBe(false);
    const rings = compileRegion(face);
    expect(rings.length).toBeGreaterThanOrEqual(2);

    const top = regionValue(face, { contains: { x: 2, y: 1.7 } });
    expect(regionContains(top, { x: 2, y: 1.7 })).toBe(true);
    expect(regionContains(top, { x: 2, y: 0.3 })).toBe(false);
    expect(compileRegion(top).length).toBe(1);

    const miss = regionValue(face, { contains: { x: 2, y: 1 } });
    expect(regionContains(miss, { x: 2, y: 1.7 })).toBe(false);
    expect(compileRegion(miss)).toHaveLength(0);
  });

  test("contains keeps a C-shape as one component through the spine", () => {
    const face = regionValue(rect(0, 0, 4, 3), { subtract: rect(1, 1, 4.5, 2) });
    const top = regionValue(face, { contains: { x: 3, y: 2.5 } });
    expect(regionContains(top, { x: 3, y: 2.5 })).toBe(true);
    expect(regionContains(top, { x: 3, y: 0.5 })).toBe(true);
    expect(regionContains(top, { x: 0.4, y: 1.5 })).toBe(true);
  });

  test("contains clip is the occupied flood, not one island AABB", () => {
    const top = regionValue(rect(0, 0, 4, 2), {
      subtract: stadium(2, 1, 5, 0.35),
      contains: { x: 2, y: 1.7 },
    });
    const clip = regionPaint(top).islandClip ?? "";
    expect(clip.split("Z").length).toBeGreaterThan(3);
    expect(regionContains(top, { x: 2, y: 0.3 })).toBe(false);
  });

  test("half-plane keep splits without trimming stock", () => {
    const face = regionValue(rect(0, 0, 4, 2));
    const left = regionValue(face, { keep: leftOfValue(split) });
    const right = regionValue(face, { keep: rightOfValue(split) });
    expect(regionContains(left, { x: 0.5, y: 1 })).toBe(true);
    expect(regionContains(left, { x: 3.5, y: 1 })).toBe(false);
    expect(regionContains(right, { x: 3.5, y: 1 })).toBe(true);
    expect(regionContains(right, { x: 0.5, y: 1 })).toBe(false);
    expect(regionContains(face, { x: 3.5, y: 1 })).toBe(true);
  });

  test("regionPaint keeps stadium arcs instead of marching-square polylines", () => {
    const stock = rect(0, 0, 4, 2);
    const slot = stadium(2, 1, 2, 0.8);
    const face = regionValue(stock, { subtract: slot });
    const paint = regionPaint(face);
    expect(paint.empty).toBe(false);
    expect(paint.stock).toEqual({ kind: "profile", d: profileSvgPath(stock) });
    expect(paint.holes).toHaveLength(1);
    const hole = paint.holes[0]!;
    expect(hole.kind).toBe("profile");
    if (hole.kind !== "profile") throw new Error("expected profile hole");
    expect(hole.d).toBe(profileSvgPath(slot));
    expect(hole.d).toContain("A ");
    const jaggy = regionSvgPath(face);
    expect(jaggy).not.toContain("A ");
    expect(jaggy.split("L ").length).toBeGreaterThan(20);
  });

  test("filleted stock keeps arc commands in the mask stock path", () => {
    const corners = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
      { x: 0, y: 2 },
    ];
    const cycle: unknown[] = [];
    for (let i = 0; i < 4; i++) {
      const a = corners[i]!;
      const b = corners[(i + 1) % 4]!;
      cycle.push(filletValue(a, 0.2), seg(a, b));
    }
    const stock = profileValue(cycle);
    const paint = regionPaint(regionValue(stock, { subtract: disk(1, 1, 0.3) }));
    expect(paint.stock.kind).toBe("profile");
    if (paint.stock.kind !== "profile") throw new Error("expected profile stock");
    expect(paint.stock.d).toContain("A ");
    expect(paint.holes).toEqual([{ kind: "circle", cx: 1, cy: 1, r: 0.3 }]);
  });

  test("overlay halo masks invert the fill so the ring sits outside", () => {
    expect(REGION_MASK.fill.canvas).toBe("#000");
    expect(REGION_MASK.fill.stock).toBe("#fff");
    expect(REGION_MASK.fill.hole).toBe("#000");
    expect(REGION_MASK.outsideStock.canvas).toBe("#fff");
    expect(REGION_MASK.outsideStock.stock).toBe("#000");
    expect(REGION_MASK.outside.hole).toBe("#fff");
    expect(REGION_MASK.outside.stock).toBe("#000");
  });

  test("contains isolates one island with a clip rect, not a compiled outline", () => {
    const face = regionValue(rect(0, 0, 4, 2), { subtract: stadium(2, 1, 5, 0.35) });
    const top = regionValue(face, { contains: { x: 2, y: 1.7 } });
    const paint = regionPaint(top);
    expect(paint.empty).toBe(false);
    expect(paint.islandClip).toMatch(/^M /);
    expect(regionContains(top, { x: 2, y: 1.7 })).toBe(true);
    expect(regionContains(top, { x: 2, y: 0.3 })).toBe(false);
    expect(regionPaint(regionValue(face, { contains: { x: 2, y: 1 } })).empty).toBe(true);
  });

  test("half-plane keep is a clip polygon", () => {
    const paint = regionPaint(regionValue(rect(0, 0, 4, 2), { keep: leftOfValue(split) }));
    expect(paint.empty).toBe(false);
    expect(paint.keepClip).toMatch(/^M /);
    expect(paint.islandClip).toBeUndefined();
  });

  test("NaN keep operand NaNs the derived region, not the stock", () => {
    const face = regionValue(rect(0, 0, 2, 2));
    const bad: Line = { kind: "line", origin: { x: Number.NaN, y: 0 }, direction: { x: 0, y: 1 } };
    const left = regionValue(face, { keep: leftOfValue(bad) });
    expect(left.subtract).toEqual([]);
    expect(face.stock.kind).toBe("profile");
    expect(regionContains(face, { x: 1, y: 1 })).toBe(true);
    expect(regionContains(left, { x: 1, y: 1 })).toBe(false);
  });

  test("mask paint and SDF pick stay cheaper than compiling four outlines", () => {
    const cutters = () => [
      disk(0.5, 0.5, 0.16),
      disk(3.5, 0.5, 0.16),
      disk(3.5, 1.5, 0.16),
      disk(0.5, 1.5, 0.16),
      stadium(3.55, 1, 1.7, 0.42),
    ];
    const makeFace = () => regionValue(rect(0, 0, 4, 2), { subtract: cutters() });
    const tPaint = performance.now();
    for (let i = 0; i < 4; i++) regionPaint(makeFace());
    const paintMs = performance.now() - tPaint;
    const face = makeFace();
    const tSdf = performance.now();
    for (let i = 0; i < 800; i++)
      distToRegion(face, { x: (i % 40) * 0.1, y: ((i / 40) | 0) * 0.1 });
    const sdfMs = performance.now() - tSdf;
    const tCompile = performance.now();
    for (let i = 0; i < 4; i++) compileRegion(makeFace());
    const compileMs = performance.now() - tCompile;
    expect(paintMs).toBeLessThan(compileMs);
    expect(sdfMs).toBeLessThan(compileMs);
  });
});
