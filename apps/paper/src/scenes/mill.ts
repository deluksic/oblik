import { line3 } from "@design-scenes/geom";
import { withoutWidgets } from "@design-scenes/euclid2";
import { editPointOnLine3 } from "@design-scenes/euclid3";
import { drawMill, millFromPlate } from "../demo/mill.ts";
import { plateLayout } from "./plate.ts";

export const title = "Mill 3D";
export const view = "euclid3" as const;
export const sceneFile = "mill.ts";
export const hint = "XY from plate.ts · glider is thickness · LMB orbit";

let readPlate = plateLayout;

if (import.meta.hot) {
  import.meta.hot.accept("./plate.ts", (mod) => {
    if (mod && "plateLayout" in mod) {
      readPlate = mod.plateLayout as typeof plateLayout;
    }
  });
}

/**
 * 3D mill — XY comes from plate.ts with 2D gizmos silenced so this file
 * owns a single widget: stock thickness (Z).
 *
 * withoutWidgets is required: otherwise plateLayout() would enqueue 2D
 * gizmos while evaluating this scene. Silent evaluation reads a published
 * plate snapshot (split view), keyed by each edit* UUID, not mill’s live map.
 * Pass the channel that the 2D pane published (`"plate"`).
 */
export function scene() {
  const plate = withoutWidgets(() => readPlate(), "plate");
  const { x, y } = plate.stock.min;
  const mast = line3({ x, y, z: 0 }, { x, y, z: 8 });
  const thickness = Math.max(0.5, editPointOnLine3(mast, 0.18).z);
  return drawMill(millFromPlate(plate, thickness));
}
