import type { Vec2 } from "@design-scenes/geom";
import { cylinder, sphere, unionAll, type Sdf } from "@design-scenes/sdf";

import { pack7, ringBalls } from "./cylinder.ts";

export type QuatrefoilOpts = {
  origin?: Vec2;
  rotation?: number;
  height: number;
  ringR: number;
  centerR: number;
  ringBallR: number;
};

/**
 * Quatrefoil cutters on a cell: four balls on a ring plus one at the axis,
 * all centred at z = height.
 */
export function quatrefoilBalls(opts: QuatrefoilOpts): Sdf {
  const o = opts.origin ?? { x: 0, y: 0 };
  const rotation = opts.rotation ?? 0;
  const top = opts.height;
  const ringBallR = Math.abs(opts.ringBallR);
  const centerR = Math.abs(opts.centerR);
  return unionAll([
    sphere({ x: o.x, y: o.y, z: top }, centerR),
    ...ringBalls(opts.ringR, rotation).map((b) =>
      sphere({ x: o.x + b.x, y: o.y + b.y, z: top }, ringBallR),
    ),
  ]);
}

/** Disk fill for each packed rim: Z-up cylinder from z=0 to z=height. */
export function packedCylinderCores(opts: { radius: number; height: number }): Sdf {
  const R = Math.abs(opts.radius);
  const halfH = Math.abs(opts.height) / 2;
  return unionAll(
    pack7(opts.radius).map((cell) =>
      cylinder({ x: cell.origin.x, y: cell.origin.y, z: halfH }, R, halfH),
    ),
  );
}

/** One quatrefoil in the middle, six around — foils follow the pack angle. */
export function quatrefoilBallsPack(opts: QuatrefoilOpts & { radius: number }): Sdf {
  return unionAll(
    pack7(opts.radius).map((cell) =>
      quatrefoilBalls({
        ...opts,
        origin: cell.origin,
        rotation: cell.rotation,
      }),
    ),
  );
}
