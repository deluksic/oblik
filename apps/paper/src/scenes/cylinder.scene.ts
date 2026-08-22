import { circle } from "@design-scenes/geom";

import { CYLINDER_RADIUS, drawCylinderPlan, type CylinderLayout } from "../demo/cylinder";

export const title = "Cylinder plan";
export const sceneFile = "cylinder.scene.ts";
export const camera = { x: 0, y: 0, scale: 16 };

const origin = { x: 0, y: 0 };

/**
 * Plan of seven packed cylinders. Widgets live on the centre cell:
 * quatrefoil ring radius, centre ball Ø, foil Ø. The hex pack is fixed.
 */
export function cylinderLayout(): CylinderLayout {
  const ringR = circle(origin, 1.21).radius;
  const centerR = circle(origin, 0.92).radius;
  const ring0 = { x: 0, y: -ringR };
  const ringBallR = circle(ring0, 0.87).radius;
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
