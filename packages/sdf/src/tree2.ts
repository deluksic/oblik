import type { Vec2 } from "@design-scenes/geom";


const { abs, max, min, sqrt } = Math;
/** 2D field. No identity. `q.x` is radial, `q.y` is Z when swept. */
export type Sdf2 =
  | { k: "circle"; c: Vec2; r: number }
  | { k: "smoothUnion"; a: Sdf2; b: Sdf2; ksoft: number }
  | { k: "union"; a: Sdf2; b: Sdf2 };

export function circle2(c: Vec2, r: number): Sdf2 {
  return { k: "circle", c, r: abs(r) };
}

export function union2(a: Sdf2, b: Sdf2): Sdf2 {
  return { k: "union", a, b };
}

export function smoothUnion2(a: Sdf2, b: Sdf2, ksoft: number): Sdf2 {
  return { k: "smoothUnion", a, b, ksoft: max(0, ksoft) };
}

export function smoothUnionAll2(nodes: Sdf2[], ksoft: number): Sdf2 {
  if (nodes.length === 0) return circle2({ x: 0, y: 0 }, 0);
  let acc = nodes[0]!;
  for (let i = 1; i < nodes.length; i++) {
    acc = smoothUnion2(acc, nodes[i]!, ksoft);
  }
  return acc;
}

function smin(a: number, b: number, k: number): number {
  const kk = max(k, 1e-6);
  const h = min(1, max(0, 0.5 + (0.5 * (b - a)) / kk));
  return b * (1 - h) + a * h - kk * h * (1 - h);
}

export function evalSdf2(sdf: Sdf2, p: Vec2): number {
  switch (sdf.k) {
    case "circle":
      return sqrt((p.x - sdf.c.x) * (p.x - sdf.c.x) + (p.y - sdf.c.y) * (p.y - sdf.c.y)) - sdf.r;
    case "union":
      return min(evalSdf2(sdf.a, p), evalSdf2(sdf.b, p));
    case "smoothUnion":
      return smin(evalSdf2(sdf.a, p), evalSdf2(sdf.b, p), sdf.ksoft);
  }
}
