import { editDistanceToPoint } from "@design-scenes/euclid2";
import {
  CYLINDER_RADIUS,
  drawCylinderPlan,
  type CylinderLayout,
} from "../demo/cylinder.ts";

export const title = "Cylinder plan";
export const sceneFile = "cylinder.ts";
export const camera = { x: 0, y: 0, scale: 16 };

const origin = { x: 0, y: 0 };

/**
 * Plan of seven packed cylinders. Widgets live on the centre cell:
 * quatrefoil ring radius, centre ball Ø, foil Ø. The hex pack is fixed.
 */
export function cylinderLayout(): CylinderLayout {
  const ringR = editDistanceToPoint(origin, 1.21);
  const centerR = editDistanceToPoint(origin, 0.92);
  const ring0 = { x: 0, y: -ringR };
  const ringBallR = editDistanceToPoint(ring0, 0.87);
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
