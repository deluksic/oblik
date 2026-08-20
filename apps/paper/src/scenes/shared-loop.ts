import { circle, group } from "@design-scenes/geom";
import { editDistanceToPoint, editPoint } from "@design-scenes/euclid2";

export const title = "Shared loop";
export const sceneFile = "shared-loop.ts";
export const hint = "Five rings, one 0.4. Drag any dashed circle — all follow.";
export const camera = { x: 0, y: 0, scale: 48 };

/**
 * One CallExpression, five gizmos. Drag any ring: overlay updates all five;
 * pointer-up rewrites the single 0.4.
 */
export function scene() {
  const o = editPoint(-0.86, -0.36);
  const rings = [];
  for (let i = 0; i < 5; i++) {
    const ang = (i / 5) * Math.PI * 2;
    const p = {
      x: o.x + Math.cos(ang) * 2.2,
      y: o.y + Math.sin(ang) * 2.2,
    };
    const r = editDistanceToPoint(p, 1.54);
    rings.push(circle(p, r));
  }
  return group(() => rings);
}
