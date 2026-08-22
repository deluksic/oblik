import { circle, point } from "@design-scenes/geom";

import { PROFILE_SMOOTH, profileSdf, type ProfileLayout } from "../demo/profile";

export const title = "Sweep profile";
export const view = "sdf2" as const;
export const sceneFile = "profile.scene.ts";
export const camera = { x: 0.2, y: 0.32, scale: 110 };
export const hint = "X = radial from each rim · Y is world Z";

/**
 * Meridian of the molding. X is radial from each of the seven rims
 * (0 = on the circle), Y is world Z. Three unrolled circles.
 */
export function profileLayout(): ProfileLayout {
  const c0 = point(-0.01, 0.1);
  const r0 = circle(c0, 0.2).radius;
  const c1 = point(-0.01, 0.38);
  const r1 = circle(c1, 0.05).radius;
  const c2 = point(0.16, 0.03);
  const r2 = circle(c2, 0.11).radius;
  return {
    circles: [
      { c: c0, r: r0 },
      { c: c1, r: r1 },
      { c: c2, r: r2 },
    ],
    k: PROFILE_SMOOTH,
  };
}

export function scene() {
  return profileSdf(profileLayout());
}
