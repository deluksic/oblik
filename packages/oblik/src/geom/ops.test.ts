import { describe, expect, test } from "vitest";

import {
  circleCircleIntersectionValue,
  circleLineIntersectionValue,
  commonTangentBasis,
  commonTangentLineValue,
  infiniteLineAxis,
  lineBasis,
  perpendicularLineValue,
  tangentContactValue,
  tangentLineValue,
} from "./ops";
import type { Circle, Line, ParallelLine } from "./types";
import { dist, dot, perp, sub } from "./vec";

const { sqrt } = Math;
const a: Circle = { kind: "circle", center: { x: 0, y: 0 }, radius: 2 };
const b: Circle = { kind: "circle", center: { x: 2, y: 0 }, radius: 2 };
const ground: Line = { kind: "line", origin: { x: 0, y: 0 }, direction: { x: 1, y: 0 } };

describe("infiniteLineAxis", () => {
  test("reads line and parallelLine", () => {
    expect(infiniteLineAxis(ground)).toEqual({ origin: ground.origin, dir: ground.direction });
    const offset: ParallelLine = {
      kind: "parallelLine",
      line: { kind: "line", origin: { x: 0, y: 1 }, direction: { x: 1, y: 0 } },
      distance: 1,
    };
    expect(infiniteLineAxis(offset)).toEqual({
      origin: offset.line.origin,
      dir: offset.line.direction,
    });
  });

  test("returns undefined for other kinds and missing fields", () => {
    expect(infiniteLineAxis(undefined)).toBeUndefined();
    expect(
      infiniteLineAxis({ kind: "circle", center: { x: 0, y: 0 }, radius: 1 } as never),
    ).toBeUndefined();
    expect(
      infiniteLineAxis({ kind: "segment", a: { x: 0, y: 0 }, b: { x: 1, y: 0 } } as never),
    ).toBeUndefined();
    expect(infiniteLineAxis({ kind: "parallelLine" })).toBeUndefined();
    expect(infiniteLineAxis({ kind: "line" })).toBeUndefined();
  });
});

describe("perpendicularLineValue", () => {
  test("passes through the point and is normal to the carrier", () => {
    const through = { x: 2, y: 3 };
    const perpLn = perpendicularLineValue(ground, through);
    expect(perpLn.origin).toEqual(through);
    const { dir } = lineBasis(ground);
    expect(dot(perpLn.direction, dir)).toBeCloseTo(0);
    expect(dot(perpLn.direction, perp(dir))).toBeGreaterThan(0);
  });
});

describe("circleCircleIntersectionValue", () => {
  test("freezes k as the side of the center line", () => {
    const plus = circleCircleIntersectionValue(a, b, 1);
    const minus = circleCircleIntersectionValue(a, b, -1);
    expect(plus.x).toBeCloseTo(1);
    expect(plus.y).toBeCloseTo(sqrt(3));
    expect(minus.x).toBeCloseTo(1);
    expect(minus.y).toBeCloseTo(-sqrt(3));
  });

  test("misses are NaN, not a hop to the other root", () => {
    const far: Circle = { kind: "circle", center: { x: 10, y: 0 }, radius: 1 };
    const p = circleCircleIntersectionValue(a, far, 1);
    expect(p.x).toBeNaN();
    expect(p.y).toBeNaN();
  });

  test("coincident centers are NaN", () => {
    const same: Circle = { kind: "circle", center: { x: 0, y: 0 }, radius: 3 };
    const p = circleCircleIntersectionValue(a, same, 1);
    expect(p.x).toBeNaN();
  });
});

describe("circleLineIntersectionValue", () => {
  test("a numerically shy tangent still hits", () => {
    const c: Circle = { kind: "circle", center: { x: 0, y: 0 }, radius: 1 };
    const line = {
      kind: "line" as const,
      origin: { x: 1 + 1e-12, y: 0 },
      direction: { x: 0, y: 1 },
    };
    const p = circleLineIntersectionValue(c, line, 1);
    expect(p.x).toBeCloseTo(1, 6);
    expect(p.y).toBeCloseTo(0, 6);
  });
});

describe("tangentLineValue", () => {
  const c: Circle = { kind: "circle", center: { x: 0, y: 0 }, radius: 1 };
  const p = { x: 2, y: 0 };

  test("contacts sit on the circle on either side of the axis", () => {
    const up = tangentContactValue(c, p, 1);
    const down = tangentContactValue(c, p, -1);
    expect(up.x).toBeCloseTo(0.5);
    expect(up.y).toBeCloseTo(sqrt(3) / 2);
    expect(down.x).toBeCloseTo(0.5);
    expect(down.y).toBeCloseTo(-sqrt(3) / 2);
    expect(dist(up, c.center)).toBeCloseTo(1);
  });

  test("the line passes through p and is normal to the radius at the contact", () => {
    for (const k of [1, -1] as const) {
      const ln = tangentLineValue(c, p, k);
      const contact = tangentContactValue(c, p, k);
      expect(dot(sub(contact, c.center), sub(contact, p))).toBeCloseTo(0);
      // carrier through p and the contact
      expect(Math.abs(dist(p, ln.origin))).toBeLessThan(1e-9);
      const toContact = sub(contact, p);
      const cross = toContact.x * ln.direction.y - toContact.y * ln.direction.x;
      expect(Math.abs(cross)).toBeLessThan(1e-9);
    }
  });

  test("an oblique point p picks the contacts either side of its axis", () => {
    const q = { x: 3, y: 4 };
    const up = tangentContactValue(c, q, 1);
    const down = tangentContactValue(c, q, -1);
    const axis = sub(q, c.center);
    // both contacts on the circle
    expect(dist(up, c.center)).toBeCloseTo(1);
    expect(dist(down, c.center)).toBeCloseTo(1);
    // on opposite sides of the p–center axis
    const n = perp(axis);
    const sUp = dot(n, sub(up, c.center));
    const sDown = dot(n, sub(down, c.center));
    expect(sUp * sDown).toBeLessThan(0);
  });

  test("p strictly inside has no tangent (NaN), p at the center too", () => {
    const inside = tangentLineValue(c, { x: 0.5, y: 0 }, 1);
    expect(inside.origin.x).toBeNaN();
    expect(tangentContactValue(c, { x: 0.5, y: 0 }, 1).x).toBeNaN();
    expect(tangentContactValue(c, c.center, 1).x).toBeNaN();
  });

  test("p on the circle degenerates to the tangent at p", () => {
    const on = { x: 1, y: 0 };
    const contact = tangentContactValue(c, on, 1);
    expect(contact.x).toBeCloseTo(1);
    expect(contact.y).toBeCloseTo(0);
    const ln = tangentLineValue(c, on, 1);
    expect(dot(ln.direction, { x: 1, y: 0 })).toBeCloseTo(0);
  });

  test("k is a consistent side: the two lines are the two distinct tangents", () => {
    const up = tangentLineValue(c, p, 1);
    const down = tangentLineValue(c, p, -1);
    expect(Math.abs(dot(up.direction, down.direction))).toBeLessThan(0.99);
  });
});

describe("commonTangentBasis", () => {
  const big: Circle = { kind: "circle", center: { x: 0, y: 0 }, radius: 2 };
  const small: Circle = { kind: "circle", center: { x: 5, y: 0 }, radius: 1 };

  test("outer tangents touch both circles on the same side", () => {
    const up = commonTangentBasis(big, small, "outer", 1);
    expect(up).toBeDefined();
    if (!up) return;
    // contacts on the upper belt: (0.4, ±2√24/5 scaled) and (5.2, √24/5)
    expect(up.contactA.x).toBeCloseTo(0.4);
    expect(up.contactA.y).toBeCloseTo((2 * sqrt(24)) / 5);
    expect(up.contactB.x).toBeCloseTo(5.2);
    expect(up.contactB.y).toBeCloseTo(sqrt(24) / 5);
    // both contacts on their circles
    expect(dist(up.contactA, big.center)).toBeCloseTo(2);
    expect(dist(up.contactB, small.center)).toBeCloseTo(1);
    // tangent segment length L = √(d² − Δr²), unit direction needs no root
    expect(dist(up.contactA, up.contactB)).toBeCloseTo(sqrt(24));
    // radius at each contact ⊥ the line
    expect(dot(up.direction, sub(up.contactA, big.center))).toBeCloseTo(0);
    expect(dot(up.direction, sub(up.contactB, small.center))).toBeCloseTo(0);

    const down = commonTangentBasis(big, small, "outer", -1);
    if (!down) return;
    expect(down.contactA.y).toBeCloseTo(-(2 * sqrt(24)) / 5);
    expect(down.contactB.y).toBeCloseTo(-sqrt(24) / 5);
  });

  test("inner tangents touch the circles on opposite sides and cross", () => {
    const up = commonTangentBasis(big, small, "inner", 1);
    if (!up) return;
    expect(up.contactA.x).toBeCloseTo(1.2);
    expect(up.contactA.y).toBeCloseTo(1.6);
    expect(up.contactB.x).toBeCloseTo(4.4);
    expect(up.contactB.y).toBeCloseTo(-0.8);
    expect(dist(up.contactA, up.contactB)).toBeCloseTo(sqrt(25 - 9)); // L = √(d² − (r1+r2)²)
    expect(dot(up.direction, sub(up.contactA, big.center))).toBeCloseTo(0);
    expect(dot(up.direction, sub(up.contactB, small.center))).toBeCloseTo(0);
  });

  test("equal radii: outer tangents are the two parallel belts", () => {
    const o1: Circle = { kind: "circle", center: { x: 0, y: 0 }, radius: 1 };
    const o2: Circle = { kind: "circle", center: { x: 5, y: 0 }, radius: 1 };
    const up = commonTangentBasis(o1, o2, "outer", 1);
    if (!up) return;
    expect(up.contactA).toEqual({ x: 0, y: 1 });
    expect(up.contactB).toEqual({ x: 5, y: 1 });
    expect(dot(up.direction, { x: 1, y: 0 })).toBeCloseTo(1);
  });

  test("no tangent when one circle is inside the other or concentric", () => {
    const outer: Circle = { kind: "circle", center: { x: 0, y: 0 }, radius: 5 };
    const inner: Circle = { kind: "circle", center: { x: 1, y: 0 }, radius: 1 };
    expect(commonTangentBasis(outer, inner, "outer", 1)).toBeUndefined();
    expect(commonTangentBasis(outer, inner, "inner", 1)).toBeUndefined();
    const sameCenter: Circle = { kind: "circle", center: { x: 0, y: 0 }, radius: 1 };
    expect(commonTangentBasis(outer, sameCenter, "outer", 1)).toBeUndefined();
    expect(commonTangentLineValue(outer, inner, "outer", 1).origin.x).toBeNaN();
  });

  test("internal tangency (d = |r1 − r2|): a single outer tangent at the touch point", () => {
    const outer: Circle = { kind: "circle", center: { x: 0, y: 0 }, radius: 5 };
    const inner: Circle = { kind: "circle", center: { x: 4, y: 0 }, radius: 1 };
    const t = commonTangentBasis(outer, inner, "outer", 1);
    if (!t) return;
    expect(t.contactA.x).toBeCloseTo(5);
    expect(t.contactB.x).toBeCloseTo(5);
    expect(dot(t.direction, { x: 1, y: 0 })).toBeCloseTo(0); // ⊥ the center line
    expect(commonTangentBasis(outer, inner, "inner", 1)).toBeUndefined();
  });

  test("external tangency (d = r1 + r2): the inner tangent at the meeting point", () => {
    const o1: Circle = { kind: "circle", center: { x: 0, y: 0 }, radius: 1 };
    const o2: Circle = { kind: "circle", center: { x: 2, y: 0 }, radius: 1 };
    const t = commonTangentBasis(o1, o2, "inner", 1);
    if (!t) return;
    expect(t.contactA.x).toBeCloseTo(1);
    expect(t.contactB.x).toBeCloseTo(1);
    expect(dot(t.direction, { x: 1, y: 0 })).toBeCloseTo(0);
    const outer = commonTangentBasis(o1, o2, "outer", 1);
    if (!outer) return;
    expect(outer.contactA.y).toBeCloseTo(1); // the usual belt still exists
  });
});
