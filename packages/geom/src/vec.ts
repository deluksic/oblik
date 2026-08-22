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
  return Math.hypot(a.x, a.y);
}

export function norm(a: Vec2): Vec2 {
  const l = len(a);
  if (l < 1e-9) return vec(1, 0);
  return mul(a, 1 / l);
}

export function perp(a: Vec2): Vec2 {
  return vec(-a.y, a.x);
}

export function lerp(a: Vec2, b: Vec2, t: number): Vec2 {
  return vec(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
}

export function dist(a: Vec2, b: Vec2): number {
  return len(sub(b, a));
}

export function projectT(a: Vec2, b: Vec2, p: Vec2): number {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  if (l2 < 1e-12) return 0;
  return dot(sub(p, a), ab) / l2;
}

export function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const t = Math.min(1, Math.max(0, projectT(a, b, p)));
  return dist(p, lerp(a, b, t));
}

/** Signed 2D cross of direction vectors (z component). */
export function cross2(a: Vec2, b: Vec2): number {
  return a.x * b.y - a.y * b.x;
}

/** Distance from `p` to the infinite line through `origin` along unit `dir`. */
export function distToLine(p: Vec2, origin: Vec2, dir: Vec2): number {
  const n = perp(dir);
  return Math.abs(dot(sub(p, origin), n));
}

export function polar(r: number, radians: number): Vec2 {
  return vec(r * Math.cos(radians), r * Math.sin(radians));
}

export function ang(p: Vec2): number {
  return Math.atan2(p.y, p.x);
}

/** Rotate `p` around the origin. */
export function rotate(p: Vec2, radians: number): Vec2 {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return vec(p.x * c - p.y * s, p.x * s + p.y * c);
}

export function rotateAround(p: Vec2, origin: Vec2, radians: number): Vec2 {
  return add(origin, rotate(sub(p, origin), radians));
}

export function wrapTau(a: number): number {
  const tau = Math.PI * 2;
  let x = a % tau;
  if (x < 0) x += tau;
  return x;
}

/** CCW sweep from `a0` to `a1` in [0, 2π). */
export function sweepCCW(a0: number, a1: number): number {
  return wrapTau(a1 - a0);
}

export function distToArc(p: Vec2, center: Vec2, radius: number, a0: number, a1: number): number {
  const r = Math.abs(radius);
  const rel = sub(p, center);
  const d = len(rel);
  const theta = ang(rel);
  const span = sweepCCW(a0, a1);
  const fromStart = wrapTau(theta - a0);
  if (fromStart <= span || span < 1e-9) {
    return Math.abs(d - r);
  }
  return Math.min(dist(p, add(center, polar(r, a0))), dist(p, add(center, polar(r, a1))));
}
