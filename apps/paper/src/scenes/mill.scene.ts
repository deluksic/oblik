import { line3 } from "@design-scenes/geom";
import { withoutWidgets } from "@design-scenes/euclid2";
import { editPointOnSegment3 } from "@design-scenes/euclid3";
import { drawMill, millFromPlate } from "../demo/mill.ts";
import { plateLayout } from "./plate-layout.ts";

export const title = "Mill 3D";
export const view = "euclid3" as const;
export const sceneFile = "mill.scene.ts";
export const hint = "XY from plate-layout.ts · glider is thickness · LMB orbit";

let readPlate = plateLayout;

if (import.meta.hot) {
  import.meta.hot.accept("./plate-layout.ts", (mod) => {
    if (mod && "plateLayout" in mod) {
      readPlate = mod.plateLayout as typeof plateLayout;
    }
  });
}

/**
 * 3D mill — XY comes from plate-layout.ts with 2D gizmos silenced so this file
 * owns a single widget: stock thickness (Z).
 */
export function scene() {
  const plate = withoutWidgets(() => readPlate(), "plate");
  const { x, y } = plate.stock.min;
  const mast = line3({ x, y, z: 0 }, { x, y, z: 8 });
  const thickness = Math.max(0.5, editPointOnSegment3(mast, 0.18).z);
  return drawMill(millFromPlate(plate, thickness));
}
