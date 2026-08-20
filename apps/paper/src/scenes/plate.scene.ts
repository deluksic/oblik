import { drawPlate } from "../demo/plate.ts";
import { plateLayout } from "./plate-layout.ts";

export const title = "Milled plate";
export const sceneFile = "plate.scene.ts";
export const hint =
  "Coral arrow: corner inset (mirrored). Bisector gliders set pocket fillet; nested helpers share one Ø per ring group.";

export function scene() {
  return drawPlate(plateLayout());
}
