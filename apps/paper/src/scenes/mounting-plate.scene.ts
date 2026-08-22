import { group } from "@design-scenes/geom";

import { drawMountingPlate } from "../demo/mounting-plate";
import { mountingPlateLayout } from "./mounting-plate-layout";

export const title = "Mounting plate";
export const sceneFile = "mounting-plate.scene.ts";
export const hint = "Construction in layout; pure drawMountingPlate in demo/.";
export const camera = { x: 2, y: 0.5, scale: 48 };

export function scene() {
  return group(() => drawMountingPlate(mountingPlateLayout()));
}
