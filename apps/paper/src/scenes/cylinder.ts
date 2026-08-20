import { editDistanceToPoint } from "@design-scenes/euclid2";
import {
  CYLINDER_RADIUS,
  drawCylinderPlan,
  type CylinderLayout,
} from "../demo/cylinder.ts";

export const sceneFile = "cylinder.ts";

const origin = { x: 0, y: 0 };

/**
 * Plan of the cylinder top. Ring radius, centre ball Ø, and outer
 * ball Ø are widgets. Cylinder radius is a constant.
 */
export function cylinderLayout(): CylinderLayout {
  const ringR = editDistanceToPoint(origin, 1.26);
  const centerR = editDistanceToPoint(origin, 0.77);
  const ring0 = { x: 0, y: -ringR };
  const ringBallR = editDistanceToPoint(ring0, 0.5);
  return {
    radius: CYLINDER_RADIUS,
    ringR,
    centerR,
    ringBallR,
  };
}

export function scene() {
  return drawCylinderPlan(cylinderLayout());
}
