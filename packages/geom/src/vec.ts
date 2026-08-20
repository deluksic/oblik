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
