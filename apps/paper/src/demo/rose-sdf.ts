import {
  cylinder,
  difference,
  sphere,
  unionAll,
  type Sdf,
} from "@design-scenes/sdf";
import { ringBalls } from "./cylinder.ts";

export type DimpledCylinderOpts = {
  radius: number;
  height: number;
  ringR: number;
  centerR: number;
  ringBallR: number;
};

/**
 * Z-up cylinder from z=0 to z=height. Six balls on a ring plus one at
 * the axis, all sitting on the top face.
 */
export function dimpledCylinder(opts: DimpledCylinderOpts): Sdf {
  const R = Math.max(0.4, opts.radius);
  const h = opts.height;
  const halfH = Math.abs(h) / 2;
  const ringBallR = Math.abs(opts.ringBallR);
  const centerR = Math.abs(opts.centerR);
  const body = cylinder({ x: 0, y: 0, z: halfH }, R, halfH);
  const top = h;
  const balls = [
    sphere({ x: 0, y: 0, z: top }, centerR),
    ...ringBalls(opts.ringR).map((b) =>
      sphere({ x: b.x, y: b.y, z: top }, ringBallR),
    ),
  ];
  return difference(body, unionAll(balls));
}
