import { editDistanceToPoint, editPoint } from "@design-scenes/euclid2";
import {
  PROFILE_SMOOTH,
  profileSdf,
  type ProfileLayout,
} from "../demo/profile.ts";

export const view = "sdf2" as const;
export const sceneFile = "profile.ts";

/**
 * Meridian of the molding. X is radial from each of the seven rims
 * (0 = on the circle), Y is world Z. Three unrolled circles.
 */
export function profileLayout(): ProfileLayout {
  const c0 = editPoint(0.12, 0.36);
  const r0 = editDistanceToPoint(c0, 0.3);
  const c1 = editPoint(0.48, 0.52);
  const r1 = editDistanceToPoint(c1, 0.22);
  const c2 = editPoint(-0.08, 0.14);
  const r2 = editDistanceToPoint(c2, 0.2);
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
