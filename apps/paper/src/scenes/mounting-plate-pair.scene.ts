import { editPoint } from "@design-scenes/euclid2";

import { drawMountingPlatePair } from "../demo/mounting-plate";
import { mountingPlateLayout } from "./mounting-plate-layout";

export const title = "Mounting plate pair";
export const sceneFile = "mounting-plate-pair.scene.ts";
export const hint = "Same inset and drill; drag the second origin. Instance via drawMountingPlatePair.";
export const camera = { x: 4, y: 0.5, scale: 40 };

export function scene() {
  const master = mountingPlateLayout();
  const secondOrigin = editPoint(5.5, 0);
  return drawMountingPlatePair(master, secondOrigin);
}
