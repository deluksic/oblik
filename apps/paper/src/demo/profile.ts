import type { Vec2 } from "@design-scenes/geom";
import {
  circle2,
  smoothUnionAll2,
  type Sdf2,
} from "@design-scenes/sdf";

export const PROFILE_SMOOTH = 0.16;

export type ProfileCircle = { c: Vec2; r: number };

export type ProfileLayout = {
  circles: [ProfileCircle, ProfileCircle, ProfileCircle];
  k: number;
};

/** Three circles, smooth-unioned. q.x is radial from the path, q.y is Z. */
export function profileSdf(layout: ProfileLayout): Sdf2 {
  return smoothUnionAll2(
    layout.circles.map((c) => circle2(c.c, c.r)),
    layout.k,
  );
}
