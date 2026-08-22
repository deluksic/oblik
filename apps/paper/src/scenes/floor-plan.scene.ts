import { drawFloorPlan } from "../demo/floor-plan";
import { floorPlanLayout } from "./floor-plan-layout";

export const title = "Floor plan";
export const sceneFile = "floor-plan.scene.ts";
export const hint =
  "Sliders resize rooms and dresser drawers. Drag door hinges, window, and island; swing arcs use angle handles. Corridor offset is construction-only.";
export const camera = { x: 5.8, y: 4.9, scale: 58 };

export function scene() {
  return drawFloorPlan(floorPlanLayout());
}
