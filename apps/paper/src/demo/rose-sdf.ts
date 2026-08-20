import type { Vec3 } from "@design-scenes/geom";
import {
  capsule,
  difference,
  smoothUnionAll,
  torus,
  union,
  type Sdf,
} from "@design-scenes/sdf";

export type RoseSdfOpts = {
  center: Vec3;
  roseR: number;
  holeR: number;
  thickness: number;
  /** Lobe count. */
  count: number;
  moldR: number;
};

function punch(c: Vec3, r: number, z0: number, z1: number): Sdf {
  return capsule({ x: c.x, y: c.y, z: z0 }, { x: c.x, y: c.y, z: z1 }, r);
}

/** Four overlapping bores — a quatrefoil as CSG, not a polyline. */
export function quatrefoil(
  c: Vec3,
  r: number,
  z0: number,
  z1: number,
): Sdf {
  const o = r * 0.52;
  const k = r * 0.22;
  return smoothUnionAll(
    [
      punch({ x: c.x + o, y: c.y, z: c.z }, r, z0, z1),
      punch({ x: c.x - o, y: c.y, z: c.z }, r, z0, z1),
      punch({ x: c.x, y: c.y + o, z: c.z }, r, z0, z1),
      punch({ x: c.x, y: c.y - o, z: c.z }, r, z0, z1),
    ],
    k,
  );
}

/**
 * Disk of stone, six quatrefoil lights, torus molding.
 * `count` is a loop in this library — change it in the scene literal.
 */
export function roseStone(opts: RoseSdfOpts): Sdf {
  const c = opts.center;
  const R = Math.max(0.6, opts.roseR);
  const h = Math.max(0.25, opts.thickness);
  const z0 = c.z - h / 2;
  const z1 = c.z + h / 2;
  const wall = punch(c, R, z0, z1);
  const n = Math.max(3, Math.round(opts.count));
  const cellR = Math.max(0.15, opts.holeR);
  const ring = R * 0.52;
  const over = h * 0.35;
  let holes: Sdf | null = null;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    const cell = quatrefoil(
      {
        x: c.x + Math.cos(a) * ring,
        y: c.y + Math.sin(a) * ring,
        z: c.z,
      },
      cellR,
      z0 - over,
      z1 + over,
    );
    holes = holes ? union(holes, cell) : cell;
  }
  const stone = holes ? difference(wall, holes) : wall;
  const mold = torus(c, R, Math.max(0.06, opts.moldR));
  return union(stone, mold);
}
