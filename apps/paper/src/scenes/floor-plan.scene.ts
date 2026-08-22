import { drawFloorPlan } from "../demo/floor-plan";
import { floorPlanLayout } from "./floor-plan-layout";

export const title = "Floor plan";
export const sceneFile = "floor-plan.scene.ts";
export const hint =
  "Inner walls offset from the shell. Entry hinge on the near jamb; bed and bath on the far jamb — one shared door angle.";
export const camera = { x: 5.25, y: 3.6, scale: 68 };

export function scene() {
  return drawFloorPlan(floorPlanLayout());
}
