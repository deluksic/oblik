import { editDistanceToPoint } from "@design-scenes/euclid2";
import {
  CYLINDER_RADIUS,
  RING_BALL_RADIUS,
  drawCylinderPlan,
  type CylinderLayout,
} from "../demo/cylinder.ts";

export const sceneFile = "cylinder.ts";

const origin = { x: 0, y: 0 };

/**
 * Plan of the cylinder top. Two widgets, both distances from the origin:
 * the ring the six balls sit on, and the centre ball's radius.
 */
export function cylinderLayout(): CylinderLayout {
  const ringR = editDistanceToPoint(origin, 1.26);
  const centerR = editDistanceToPoint(origin, 0.42);
  return {
    radius: CYLINDER_RADIUS,
    ringR,
    centerR,
    ringBallR: RING_BALL_RADIUS,
  };
}

export function scene() {
  return drawCylinderPlan(cylinderLayout());
}
