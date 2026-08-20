import type { Vec2 } from "@design-scenes/geom";
import {
  cylinder,
  difference,
  sphere,
  unionAll,
  type Sdf,
} from "@design-scenes/sdf";
import { pack7, ringBalls } from "./cylinder.ts";

export type DimpledCylinderOpts = {
  origin?: Vec2;
  rotation?: number;
  radius: number;
  height: number;
  ringR: number;
  centerR: number;
  ringBallR: number;
};

/**
 * Z-up cylinder from z=0 to z=height. Quatrefoil on the top face:
 * four balls on a ring plus one at the axis.
 */
export function dimpledCylinder(opts: DimpledCylinderOpts): Sdf {
  const o = opts.origin ?? { x: 0, y: 0 };
  const rotation = opts.rotation ?? 0;
  const R = Math.max(0.4, opts.radius);
  const h = opts.height;
  const halfH = Math.abs(h) / 2;
  const ringBallR = Math.abs(opts.ringBallR);
  const centerR = Math.abs(opts.centerR);
  const body = cylinder({ x: o.x, y: o.y, z: halfH }, R, halfH);
  const top = h;
  const balls = [
    sphere({ x: o.x, y: o.y, z: top }, centerR),
    ...ringBalls(opts.ringR, rotation).map((b) =>
      sphere({ x: o.x + b.x, y: o.y + b.y, z: top }, ringBallR),
    ),
  ];
  return difference(body, unionAll(balls));
}

/** One dimpled cylinder in the middle, six around — foils follow the pack angle. */
export function dimpledCylinderPack(
  opts: Omit<DimpledCylinderOpts, "origin" | "rotation">,
): Sdf {
  return unionAll(
    pack7(opts.radius).map((cell) =>
      dimpledCylinder({
        ...opts,
        origin: cell.origin,
        rotation: cell.rotation,
      }),
    ),
  );
}
