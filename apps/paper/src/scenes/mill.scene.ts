import { withoutWidgets } from "@design-scenes/euclid2";
import { pointOnSegment3 } from "@design-scenes/euclid3";
import { segment3 } from "@design-scenes/geom";

import { drawMill, millFromPlate } from "../demo/mill";
import { plateLayout } from "./plate-layout";

export const title = "Mill 3D";
export const view = "euclid3" as const;
export const sceneFile = "mill.scene.ts";
export const hint = "XY from plate-layout.ts · glider is thickness · LMB orbit";

/**
 * 3D mill — XY comes from plate-layout.ts with 2D gizmos silenced so this file
 * owns a single widget: stock thickness (Z).
 */
export function scene() {
  const plate = withoutWidgets(() => plateLayout(), "plate");
  const { x, y } = plate.stock.min;
  const mast = segment3({ x, y, z: 0 }, { x, y, z: 8 });
  const thickness = Math.max(0.5, pointOnSegment3(mast, 0.16).z);
  return drawMill(millFromPlate(plate, thickness));
}
