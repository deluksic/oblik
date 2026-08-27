import { circle, point, type Point } from "oblik";

/** Innermost helper — rim is exported; bead stays private. */
export function petal(center: Point, radius: number) {
  const rim = circle(center, radius, "o_nest_rim");
  circle(center, 0.22, "o_nest_bead");
  return { rim };
}

/** Middle helper — hub is exported; halo stays private. Calls petal. */
export function nestedCircles() {
  const origin = point(2.1, 1.45, "o_nest");
  const hub = circle(origin, 0.42, "o_nest_hub");
  circle(origin, 1.55, "o_nest_halo");
  const inner = petal(origin, 0.95);
  return { origin, hub };
}
