import { editDistanceToPoint, editNumber, editPoint } from "@design-scenes/euclid2";
import { type Vec2 } from "@design-scenes/geom";

import { drawRingPlan, drawUnrolled } from "../demo/ring.ts";

export const title = "Ring";
export const sceneFile = "ring.scene.ts";
export const camera = { x: 18, y: 3.2, scale: 14 };

export type RingLayout = {
  center: Vec2;
  origin: Vec2;
  innerR: number;
  shank: number;
  signet: number;
  gauge: number;
};

/**
 * Signet band, designed developed. Inner R is the plan-view dashed
 * circle; the strip length is 2πR. Shank and signet heights are
 * distances on the unrolled paper. Gauge feeds the wrap (3D).
 */
export function ringLayout(): RingLayout {
  const center = editPoint(-4.2, 5.5);
  const innerR = editDistanceToPoint(center, 4.87);
  const origin: Vec2 = {
    x: center.x + innerR + 2.8,
    y: center.y - innerR,
  };
  const shank = editDistanceToPoint(origin, 3.74);
  const mid: Vec2 = {
    x: origin.x + Math.PI * innerR,
    y: origin.y,
  };
  const signet = editDistanceToPoint(mid, 6.68);
  const gauge = editNumber(0.4, {
    label: "Gauge",
    min: 0.4,
    max: 3.2,
    step: 0.1,
  });
  return { center, origin, innerR, shank, signet, gauge };
}

export function scene() {
  const r = ringLayout();
  return [
    drawRingPlan(r.center, r.innerR, r.gauge),
    drawUnrolled({
      origin: r.origin,
      innerR: r.innerR,
      shank: r.shank,
      signet: r.signet,
      gauge: r.gauge,
    }),
  ];
}
