export type Vec3 = { readonly x: number; readonly y: number; readonly z: number };

export function vec3(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

export function add3(a: Vec3, b: Vec3): Vec3 {
  return vec3(a.x + b.x, a.y + b.y, a.z + b.z);
}

export function sub3(a: Vec3, b: Vec3): Vec3 {
  return vec3(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function mul3(a: Vec3, s: number): Vec3 {
  return vec3(a.x * s, a.y * s, a.z * s);
}

export function dot3(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function len3(a: Vec3): number {
  return Math.hypot(a.x, a.y, a.z);
}

export function dist3(a: Vec3, b: Vec3): number {
  return len3(sub3(b, a));
}

export function lerp3(a: Vec3, b: Vec3, t: number): Vec3 {
  return vec3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
}

export function projectT3(a: Vec3, b: Vec3, p: Vec3): number {
  const ab = sub3(b, a);
  const l2 = dot3(ab, ab);
  if (l2 < 1e-12) return 0;
  return dot3(sub3(p, a), ab) / l2;
}

export function norm3(a: Vec3): Vec3 {
  const l = len3(a);
  if (l < 1e-9) return vec3(0, 0, 1);
  return mul3(a, 1 / l);
}
