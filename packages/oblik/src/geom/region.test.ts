import { describe, expect, test } from "vitest";

import { alongValue, profileContains, profileValue } from "./profile";
import {
  compileRegion,
  distToRegion,
  formulaSdf,
  leftOfValue,
  regionContains,
  regionValue,
  rightOfValue,
} from "./region";
import type { Circle, Line, Profile, Segment } from "./types";
import type { Vec2 } from "./vec";

function seg(a: Vec2, b: Vec2): Segment {
  return { kind: "segment", a, b };
}

function rect(x0: number, y0: number, x1: number, y1: number): Profile {
  const bl = { x: x0, y: y0 };
  const br = { x: x1, y: y0 };
  const tr = { x: x1, y: y1 };
  const tl = { x: x0, y: y1 };
  return profileValue([bl, seg(bl, br), br, seg(br, tr), tr, seg(tr, tl), tl, seg(tl, bl)]);
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

  test("NaN keep operand NaNs the derived region, not the stock", () => {
    const face = regionValue(rect(0, 0, 2, 2));
    const bad: Line = { kind: "line", origin: { x: Number.NaN, y: 0 }, direction: { x: 0, y: 1 } };
    const left = regionValue(face, { keep: leftOfValue(bad) });
    expect(left.subtract).toEqual([]);
    expect(face.stock.kind).toBe("profile");
    expect(regionContains(face, { x: 1, y: 1 })).toBe(true);
    expect(regionContains(left, { x: 1, y: 1 })).toBe(false);
  });
});
