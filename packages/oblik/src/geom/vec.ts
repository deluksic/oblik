const { abs, atan2, cos, max, min, sin, sqrt } = Math;
const TWO_PI = 2 * Math.PI;
export type Vec2 = { readonly x: number; readonly y: number };

export function vec(x: number, y: number): Vec2 {
  return { x, y };
}

export function add(a: Vec2, b: Vec2): Vec2 {
  return vec(a.x + b.x, a.y + b.y);
}

export function sub(a: Vec2, b: Vec2): Vec2 {
  return vec(a.x - b.x, a.y - b.y);
}

export function mul(a: Vec2, s: number): Vec2 {
  return vec(a.x * s, a.y * s);
}

export function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

export function len(a: Vec2): number {
  return sqrt(a.x * a.x + a.y * a.y);
}

export function norm(a: Vec2): Vec2 {
  const l = len(a);
  if (l < 1e-9) return vec(1, 0);
  return mul(a, 1 / l);
}

export function perp(a: Vec2): Vec2 {
  return vec(-a.y, a.x);
}

export function dist(a: Vec2, b: Vec2): number {
  return len(sub(b, a));
}

export function lerp(a: Vec2, b: Vec2, t: number): Vec2 {
  return add(a, mul(sub(b, a), t));
}

export function projectT(a: Vec2, b: Vec2, p: Vec2): number {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  if (l2 < 1e-12) return 0;
  return dot(sub(p, a), ab) / l2;
}

export function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const t = min(1, max(0, projectT(a, b, p)));
  return dist(p, lerp(a, b, t));
}

/** Distance from `p` to the infinite line through `origin` along unit `dir`. */
export function distToLine(p: Vec2, origin: Vec2, dir: Vec2): number {
  return abs(dot(sub(p, origin), perp(dir)));
}

export function cross2(a: Vec2, b: Vec2): number {
  return a.x * b.y - a.y * b.x;
}

export function isFiniteVec(p: Vec2): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y);
}

/** Point at angle `radians` on a circle of radius `r`. */
export function polar(r: number, radians: number): Vec2 {
  return vec(r * cos(radians), r * sin(radians));
}

/** Polar angle of `p` in radians. */
export function ang(p: Vec2): number {
  return atan2(p.y, p.x);
}

/** Rotate `p` around the origin by `radians`. */
export function rotate(p: Vec2, radians: number): Vec2 {
  const c = cos(radians);
  const s = sin(radians);
  return vec(p.x * c - p.y * s, p.x * s + p.y * c);
}

/** Wrap `a` into [0, 2π). */
export function wrapTau(a: number): number {
  let x = a % TWO_PI;
  if (x < 0) x += TWO_PI;
  return x;
}

/** CCW sweep from `a0` to `a1` in [0, 2π). */
export function sweepCCW(a0: number, a1: number): number {
  return wrapTau(a1 - a0);
}
