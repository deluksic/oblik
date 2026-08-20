import { editDistanceToPoint, editPoint } from "@design-scenes/euclid2";
import {
  PROFILE_SMOOTH,
  profileSdf,
  type ProfileLayout,
} from "../demo/profile.ts";

export const title = "Sweep profile";
export const view = "sdf2" as const;
export const sceneFile = "profile.ts";
export const camera = { x: 0.2, y: 0.32, scale: 110 };
export const hint = "X = radial from each rim · Y is world Z";

/**
 * Meridian of the molding. X is radial from each of the seven rims
 * (0 = on the circle), Y is world Z. Three unrolled circles.
 */
export function profileLayout(): ProfileLayout {
  const c0 = editPoint(-0.01, 0.1);
  const r0 = editDistanceToPoint(c0, 0.2);
  const c1 = editPoint(0.02, 0.35);
  const r1 = editDistanceToPoint(c1, 0.13);
  const c2 = editPoint(0.2, 0.03);
  const r2 = editDistanceToPoint(c2, 0.11);
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
