import type { Branch, Circle, Line, LineLike, ParallelLine } from "./types";
import { add, cross2, dist, dot, isFiniteVec, mul, norm, perp, sub, vec, type Vec2 } from "./vec";

const { abs, max, sqrt } = Math;
export function lineBasis(g: LineLike): { origin: Vec2; dir: Vec2 } {
  if (g.kind === "line") return { origin: g.origin, dir: g.direction };
  if (g.kind === "parallelLine") return { origin: g.line.origin, dir: g.line.direction };
  return { origin: g.a, dir: norm(sub(g.b, g.a)) };
}

/** Axis of an infinite line, or `undefined` when `g` is missing or not line-like. */
export function infiniteLineAxis(
  g: { kind: string; origin?: Vec2; direction?: Vec2; line?: Line } | undefined,
): { origin: Vec2; dir: Vec2 } | undefined {
  if (g === undefined) return undefined;
  if (g.kind === "parallelLine") {
    const origin = g.line?.origin;
    const dir = g.line?.direction;
    if (!origin || !dir) return undefined;
    return { origin, dir };
  }
  if (g.kind === "line") {
    const origin = g.origin;
    const dir = g.direction;
    if (!origin || !dir) return undefined;
    return { origin, dir };
  }
  return undefined;
}

export function signedDist(p: Vec2, geom: LineLike): number {
  const { origin, dir } = lineBasis(geom);
  return dot(sub(p, origin), perp(dir));
}

export function parallelLineValue(geom: LineLike, signedD: number): ParallelLine {
  const { origin, dir } = lineBasis(geom);
  const n = perp(dir);
  const p = add(origin, mul(n, signedD));
  return {
    kind: "parallelLine",
    line: { kind: "line", origin: p, direction: dir },
    distance: signedD,
  };
}

/** Infinite line through `through`, perpendicular to the carrier of `geom`. */
export function perpendicularLineValue(geom: LineLike, through: Vec2): Line {
  const { dir } = lineBasis(geom);
  return { kind: "line", origin: { x: through.x, y: through.y }, direction: perp(dir) };
}

export function lineIntersectionValue(a: LineLike, b: LineLike): Vec2 {
  const la = lineBasis(a);
  const lb = lineBasis(b);
  const denom = cross2(la.dir, lb.dir);
  if (!Number.isFinite(denom) || abs(denom) < 1e-12) return vec(Number.NaN, Number.NaN);
  const t = cross2(sub(lb.origin, la.origin), lb.dir) / denom;
  const p = add(la.origin, mul(la.dir, t));
  return isFiniteVec(p) ? p : vec(Number.NaN, Number.NaN);
}

export function circleLineIntersectionValue(c: Circle, l: LineLike, k: Branch): Vec2 {
  if (!isFiniteVec(c.center) || !Number.isFinite(c.radius)) return vec(Number.NaN, Number.NaN);
  const { origin, dir } = lineBasis(l);
  const w = sub(origin, c.center);
  const dw = dot(dir, w);
  const disc = dw * dw - (dot(w, w) - c.radius * c.radius);
  const d = Number.isFinite(disc) && disc > -1e-9 ? max(0, disc) : Number.NaN;
  if (!(d >= 0)) return vec(Number.NaN, Number.NaN);
  const t = -dw + k * sqrt(d);
  const p = add(origin, mul(dir, t));
  return isFiniteVec(p) ? p : vec(Number.NaN, Number.NaN);
}

/** Circle/circle hits. `k` is the side of the center line. No hit → NaN. */
export function circleCircleIntersectionValue(a: Circle, b: Circle, k: Branch): Vec2 {
  if (!isFiniteVec(a.center) || !isFiniteVec(b.center)) return vec(Number.NaN, Number.NaN);
  if (!Number.isFinite(a.radius) || !Number.isFinite(b.radius)) return vec(Number.NaN, Number.NaN);
  const dvec = sub(b.center, a.center);
  const d = sqrt(dvec.x * dvec.x + dvec.y * dvec.y);
  if (d < 1e-12) return vec(Number.NaN, Number.NaN);
  const aa = (a.radius * a.radius - b.radius * b.radius + d * d) / (2 * d);
  const h2 = a.radius * a.radius - aa * aa;
  const h2c = Number.isFinite(h2) && h2 > -1e-9 ? max(0, h2) : Number.NaN;
  if (!(h2c >= 0)) return vec(Number.NaN, Number.NaN);
  const h = sqrt(h2c);
  const mid = add(a.center, mul(dvec, aa / d));
  const n = perp({ x: dvec.x / d, y: dvec.y / d });
  const p = add(mid, mul(n, k * h));
  return isFiniteVec(p) ? p : vec(Number.NaN, Number.NaN);
}

export type TangentBasis = { origin: Vec2; direction: Vec2; contact: Vec2 };

/**
 * Geometry of the tangent line through external point `p` to circle `c` on
 * branch `k` (which of the two tangent points is used). The contact point is
 * the classic construction: intersect `c` with the circle whose diameter is
 * the p–center segment (Thales — every point on that circle sees the diameter
 * under a right angle, so the hits are exactly where the radius meets the
 * tangent at 90°). `undefined` when no real tangent exists.
 *
 * Squared arithmetic throughout: every guard is a comparison on `d2`/`r2`, and
 * the only root is the tangent length `L = |p − T|`. The unit direction and the
 * contact fall out without a second root, because `|d·L − perp(d)·k·r| = d2`.
 */
export function tangentBasis(c: Circle, p: Vec2, k: Branch): TangentBasis | undefined {
  const { center, radius } = c;
  const r = radius;
  if (!Number.isFinite(r) || r <= 0 || !isFiniteVec(center) || !isFiniteVec(p)) return undefined;
  const d = sub(center, p); // p → center
  const d2 = dot(d, d); // D² = |p − center|² (finite, ≥ 0 after the guard above)
  const r2 = r * r;
  if (d2 === 0) return undefined; // p at the center
  if (d2 < r2) return undefined; // p strictly inside: no real tangent
  if (d2 === r2) {
    // p sits on the circle: the two tangent points collapse into p itself, so
    // the line is just the perpendicular through p.
    return {
      origin: { x: p.x, y: p.y },
      direction: perp(norm(d)),
      contact: { x: p.x, y: p.y },
    };
  }
  const l2 = d2 - r2; // L² = |p − T|²
  const l = sqrt(l2); // the only root
  // T − p = (L/D²)·(d·L − perp(d)·k·r). The parenthesised vector has length
  // exactly d2, so v/d2 is the unit direction and p + v·(L/d2) the contact.
  // The −perp(d) term keeps k = 1 on the same side as circleCircleIntersectionValue.
  const v = sub(mul(d, l), mul(perp(d), k * r));
  const contact = add(p, mul(v, l / d2));
  return {
    origin: { x: p.x, y: p.y },
    direction: mul(v, 1 / d2),
    contact,
  };
}

/** Infinite tangent line through external `p` to circle `c`, branch `k`. None → NaN line. */
export function tangentLineValue(c: Circle, p: Vec2, k: Branch): Line {
  const t = tangentBasis(c, p, k);
  return t
    ? { kind: "line", origin: t.origin, direction: t.direction }
    : { kind: "line", origin: vec(Number.NaN, Number.NaN), direction: vec(Number.NaN, Number.NaN) };
}

/** Contact point of that tangent on `c`; NaN when no real tangent exists. */
export function tangentContactValue(c: Circle, p: Vec2, k: Branch): Vec2 {
  return tangentBasis(c, p, k)?.contact ?? vec(Number.NaN, Number.NaN);
}

export type CommonTangentFamily = "outer" | "inner";

export type CommonTangentBasis = {
  /** Contact on `a` — also the line's origin. */
  origin: Vec2;
  /** Unit direction from the `a` contact to the `b` contact. */
  direction: Vec2;
  contactA: Vec2;
  contactB: Vec2;
};

/**
 * One of the two common tangents of circles `a` (radius r1) and `b` (radius
 * r2) on side `k`. `outer` tangents touch both circles on the same side
 * (`D·n = r1 − r2`); `inner` (crossing) tangents touch them on opposite sides
 * (`D·n = r1 + r2`). Same construction as the point-circle case, squared until
 * a single root: solve `D·n = s` for a unit normal n, then the contacts are
 * `O1 + r1·n` and `O2 ± r2·n`, and the tangent segment between them has length
 * `L = √(d² − s²)`, so its unit direction needs no extra root.
 * `undefined` when the family doesn't exist (d = 0, or d² < s²).
 */
export function commonTangentBasis(
  a: Circle,
  b: Circle,
  family: CommonTangentFamily,
  k: Branch,
): CommonTangentBasis | undefined {
  const r1 = a.radius;
  const r2 = b.radius;
  if (!Number.isFinite(r1) || r1 <= 0 || !Number.isFinite(r2) || r2 <= 0) return undefined;
  if (!isFiniteVec(a.center) || !isFiniteVec(b.center)) return undefined;
  const D = sub(b.center, a.center);
  const d2 = dot(D, D); // squared center distance (finite, ≥ 0 after the guard above)
  if (d2 === 0) return undefined; // concentric
  const s = family === "outer" ? r1 - r2 : r1 + r2; // D·n target
  const l2 = d2 - s * s;
  if (!(l2 >= 0)) return undefined; // no tangent in this family
  // Unit contact normal n = (s/d²)·D + k·(L/d²)·perp(D); |n| = 1 because s² + L² = d².
  const l = sqrt(l2);
  const n = add(mul(D, s / d2), mul(perp(D), (k * l) / d2));
  const touchSameSide = family === "outer"; // b contact on +n (outer) or −n (inner)
  const contactA = add(a.center, mul(n, r1));
  const contactB = add(b.center, mul(n, touchSameSide ? r2 : -r2));
  if (!isFiniteVec(contactA) || !isFiniteVec(contactB)) return undefined;
  const direction = l > 0 ? mul(sub(contactB, contactA), 1 / l) : perp(norm(D)); // tangent segment degenerates at tangency
  return { origin: { x: contactA.x, y: contactA.y }, direction, contactA, contactB };
}

/** Infinite common tangent line of two circles; `family` selects outer/inner. None → NaN line. */
export function commonTangentLineValue(
  a: Circle,
  b: Circle,
  family: CommonTangentFamily,
  k: Branch,
): Line {
  const t = commonTangentBasis(a, b, family, k);
  return t
    ? { kind: "line", origin: t.origin, direction: t.direction }
    : { kind: "line", origin: vec(Number.NaN, Number.NaN), direction: vec(Number.NaN, Number.NaN) };
}

export { dist };
