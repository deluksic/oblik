import { drawFloorPlan } from "../demo/floor-plan";
import { floorPlanLayout } from "./floor-plan-layout";

export const title = "Floor plan";
export const sceneFile = "floor-plan.scene.ts";
export const hint =
  "HUD sliders resize the flat. Drag door angles, island vector, and radius handles on doors and window.";
export const camera = { x: 5, y: 4.25, scale: 62 };

export function scene() {
  return drawFloorPlan(floorPlanLayout());
}
