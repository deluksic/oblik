import { drawFloorPlan } from "../demo/floor-plan";
import { floorPlanLayout } from "./floor-plan-layout";

export const title = "Floor plan";
export const sceneFile = "floor-plan.scene.ts";
export const hint =
  "Thick walls; door gaps follow each hinge along the wall. Sliders resize rooms; angle handles swing leaves.";
export const camera = { x: 5.25, y: 3.6, scale: 68 };

export function scene() {
  return drawFloorPlan(floorPlanLayout());
}
