import { circle, point, type Point } from "oblik";

/** Innermost helper — rim is exported; bead reuses rim.radius and stays private. */
export function petal(center: Point, radius: number) {
  const rim = circle(center, radius, "o_nest_rim");
  circle(center, rim.radius * 0.23, "o_nest_bead");
  return { rim };
}

/** Middle helper — hub is exported; halo reuses inner.rim.radius and stays private. */
export function nestedCircles() {
  const origin = point(2.1, 1.45, "o_nest");
  const hub = circle(origin, 0.42, "o_nest_hub");
  const inner = petal(origin, hub.radius * 2.25);
  circle(origin, inner.rim.radius * 1.65, "o_nest_halo");
  return { origin, hub };
}
