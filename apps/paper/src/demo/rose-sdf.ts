import type { Vec3 } from "@design-scenes/geom";
import {
  cylinder,
  difference,
  sphere,
  unionAll,
  type Sdf,
} from "@design-scenes/sdf";

export type DimpledCylinderOpts = {
  center: Vec3;
  radius: number;
  height: number;
  ballR: number;
  /** Balls around the waist. */
  count: number;
};

/**
 * Solid Z-up cylinder minus `count` spheres whose centres sit on the barrel.
 * `count` is a loop in this library — change it in the scene literal.
 */
export function dimpledCylinder(opts: DimpledCylinderOpts): Sdf {
  const c = opts.center;
  const R = Math.max(0.4, opts.radius);
  const halfH = Math.max(0.25, opts.height) / 2;
  const ballR = Math.max(0.08, opts.ballR);
  const n = Math.max(1, Math.round(opts.count));
  const body = cylinder(c, R, halfH);
  const balls: Sdf[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    balls.push(
      sphere(
        {
          x: c.x + Math.cos(a) * R,
          y: c.y + Math.sin(a) * R,
          z: c.z,
        },
        ballR,
      ),
    );
  }
  return difference(body, unionAll(balls));
}
