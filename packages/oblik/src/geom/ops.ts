import type { Branch, Circle, LineLike, OffsetLine } from "./types";
import {
  add,
  cross2,
  dist,
  dot,
  isFiniteVec,
  mul,
  norm,
  perp,
  sub,
  vec,
  type Vec2,
} from "./vec";

export function lineBasis(g: LineLike): { origin: Vec2; dir: Vec2 } {
  if (g.kind === "line") return { origin: g.origin, dir: g.direction };
  if (g.kind === "offsetLine") return { origin: g.line.origin, dir: g.line.direction };
  return { origin: g.a, dir: norm(sub(g.b, g.a)) };
}

export function signedDist(p: Vec2, geom: LineLike): number {
  const { origin, dir } = lineBasis(geom);
  return dot(sub(p, origin), perp(dir));
}

export function offsetLineValue(geom: LineLike, signedD: number): OffsetLine {
  const { origin, dir } = lineBasis(geom);
  const n = perp(dir);
  const p = add(origin, mul(n, signedD));
  return {
    kind: "offsetLine",
    line: { kind: "line", origin: p, direction: dir },
    distance: signedD,
  };
}

export function lineIntersectionValue(a: LineLike, b: LineLike): Vec2 {
  const la = lineBasis(a);
  const lb = lineBasis(b);
  const denom = cross2(la.dir, lb.dir);
  if (!Number.isFinite(denom) || Math.abs(denom) < 1e-12) return vec(Number.NaN, Number.NaN);
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
  if (!(disc >= 0) || !Number.isFinite(disc)) return vec(Number.NaN, Number.NaN);
  const t = -dw + k * Math.sqrt(disc);
  const p = add(origin, mul(dir, t));
  return isFiniteVec(p) ? p : vec(Number.NaN, Number.NaN);
}

export { dist };
