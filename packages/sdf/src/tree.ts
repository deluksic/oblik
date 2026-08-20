import type { Vec2, Vec3 } from "@design-scenes/geom";
import type { Sdf2 } from "./tree2.ts";

/** Field CSG. No id / path / provenance — the surface is not pickable. */
export type Sdf =
  | { k: "sphere"; c: Vec3; r: number }
  | { k: "box"; c: Vec3; half: Vec3 }
  | { k: "cylinder"; c: Vec3; r: number; halfH: number }
  | { k: "capsule"; a: Vec3; b: Vec3; r: number }
  | { k: "torus"; c: Vec3; R: number; r: number }
  | { k: "sweep2"; c: Vec2; pathR: number; profile: Sdf2 }
  | { k: "union"; a: Sdf; b: Sdf }
  | { k: "smoothUnion"; a: Sdf; b: Sdf; ksoft: number }
  | { k: "diff"; a: Sdf; b: Sdf }
  | { k: "inter"; a: Sdf; b: Sdf };

export function sphere(c: Vec3, r: number): Sdf {
  return { k: "sphere", c, r: Math.abs(r) };
}

export function box(c: Vec3, half: Vec3): Sdf {
  return { k: "box", c, half };
}

/** Z-up capped cylinder. `halfH` is half the height along Z. */
export function cylinder(c: Vec3, r: number, halfH: number): Sdf {
  return { k: "cylinder", c, r: Math.abs(r), halfH: Math.abs(halfH) };
}

/** Capped round cylinder (capsule) from `a` to `b`. */
export function capsule(a: Vec3, b: Vec3, r: number): Sdf {
  return { k: "capsule", a, b, r: Math.abs(r) };
}

/** Torus in the XY plane (Z-up), major `R`, minor `r`. */
export function torus(c: Vec3, R: number, r: number): Sdf {
  return { k: "torus", c, R: Math.abs(R), r: Math.abs(r) };
}

/** Torus-like sweep: 2D profile in (radial, z), around a circle in XY. */
export function sweep2(c: Vec2, pathR: number, profile: Sdf2): Sdf {
  return { k: "sweep2", c, pathR: Math.abs(pathR), profile };
}

export function union(a: Sdf, b: Sdf): Sdf {
  return { k: "union", a, b };
}

export function smoothUnion(a: Sdf, b: Sdf, ksoft: number): Sdf {
  return { k: "smoothUnion", a, b, ksoft: Math.max(0, ksoft) };
}

export function difference(a: Sdf, b: Sdf): Sdf {
  return { k: "diff", a, b };
}

export function intersection(a: Sdf, b: Sdf): Sdf {
  return { k: "inter", a, b };
}

export function unionAll(nodes: Sdf[]): Sdf {
  if (nodes.length === 0) return sphere({ x: 0, y: 0, z: 0 }, 0);
  let acc = nodes[0]!;
  for (let i = 1; i < nodes.length; i++) acc = union(acc, nodes[i]!);
  return acc;
}

export function smoothUnionAll(nodes: Sdf[], ksoft: number): Sdf {
  if (nodes.length === 0) return sphere({ x: 0, y: 0, z: 0 }, 0);
  let acc = nodes[0]!;
  for (let i = 1; i < nodes.length; i++) acc = smoothUnion(acc, nodes[i]!, ksoft);
  return acc;
}
