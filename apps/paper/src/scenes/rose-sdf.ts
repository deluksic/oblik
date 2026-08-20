import { line3 } from "@design-scenes/geom";
import { editDistance3, editPoint3, editPointOnLine3 } from "@design-scenes/euclid3";
import { dimpledCylinder } from "../demo/rose-sdf.ts";

export const view = "sdf" as const;
export const sceneFile = "rose-sdf.ts";

/**
 * Raymarched CSG. No provenance on the field. Gizmos are scene
 * widgets only — the surface itself is not pickable.
 */
export function scene() {
  const c = editPoint3(0, 0, 1.7);
  const radius = editDistance3(c, 2.15);
  const ballAt = {
    x: c.x,
    y: c.y - radius,
    z: c.z,
  };
  const ballR = editDistance3(ballAt, 0.95);
  const mast = line3(
    { x: c.x, y: c.y, z: 0 },
    { x: c.x, y: c.y, z: 5 },
  );
  const height = Math.max(0.6, editPointOnLine3(mast, 0.68).z);
  return dimpledCylinder({
    center: c,
    radius,
    height,
    ballR,
    count: 7,
  });
}
