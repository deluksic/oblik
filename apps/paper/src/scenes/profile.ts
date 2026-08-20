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
  const c0 = editPoint(-0.06, 0.25);
  const r0 = editDistanceToPoint(c0, 0.26);
  const c1 = editPoint(-0.06, 0.58);
  const r1 = editDistanceToPoint(c1, 0.1);
  const c2 = editPoint(0.23, 0.11);
  const r2 = editDistanceToPoint(c2, 0.17);
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
