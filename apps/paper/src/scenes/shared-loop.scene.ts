import { circle, point, line, signedDist, offsetLine, dist } from "@design-scenes/geom";


const { PI, cos, sin } = Math;
export const title = "Shared loop";
export const sceneFile = "shared-loop.scene.ts";
export const hint = "Five rings, one 0.4. Drag any ring — all follow.";
export const camera = { x: 0, y: 0, scale: 48 };

/**
 * One CallExpression, five gizmos. Drag any ring: overlay updates all five;
 * pointer-up rewrites the single 0.4.
 */
export function scene() {
  const o = point(0, -0.03);
  for (let i = 0; i < 5; i++) {
    const ang = (i / 5) * PI * 2;
    const p = {
      x: o.x + cos(ang) * 2.2,
      y: o.y + sin(ang) * 2.2,
    };
    circle(p, 1);
  }
  const p2 = point(3.37, 3.63);
  const ln = line(o, p2);
  const p3 = point(2.45, 4.84);
  offsetLine(ln, signedDist(p3, ln));
  circle(o, 1);
  circle(o, dist(o, p2));
}
