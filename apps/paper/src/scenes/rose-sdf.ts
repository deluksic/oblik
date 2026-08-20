import { line3 } from "@design-scenes/geom";
import { editDistance3, editPoint3, editPointOnLine3 } from "@design-scenes/euclid3";
import { roseStone } from "../demo/rose-sdf.ts";

export const view = "sdf" as const;
export const sceneFile = "rose-sdf.ts";

/**
 * Raymarched CSG. No provenance on the field. Gizmos are scene
 * widgets only — the surface itself is not pickable.
 */
export function scene() {
  const c = editPoint3(0, 0, 1.55);
  const roseR = editDistance3(c, 0.88);
  const holeAt = {
    x: c.x,
    y: c.y - roseR * 0.52,
    z: c.z,
  };
  const holeR = editDistance3(holeAt, 0.27);
  const mast = line3(
    { x: c.x, y: c.y, z: 0 },
    { x: c.x, y: c.y, z: 5 },
  );
  const thickness = Math.max(0.3, editPointOnLine3(mast, 0.32).z);
  return roseStone({
    center: c,
    roseR,
    holeR,
    thickness,
    count: 6,
    moldR: 0.26,
  });
}
