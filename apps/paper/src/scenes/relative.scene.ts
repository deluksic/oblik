import { vector } from "@design-scenes/euclid2";
import { circle, group, segment, point } from "@design-scenes/geom";

export const title = "Relative";
export const sceneFile = "relative.scene.ts";
export const hint = "Left is position. Vector widget is the offset. b is derived.";

/**
 * `a` writes position. `d` writes the offset (dx, dy). `b` is derived, not an editor.
 */
export function scene() {
  const a = point(0.38, 0.13);
  const d = vector(a, 2.14, 1.93);
  const b = point(a.x + d.x, a.y + d.y);
  const __scene = group(() => [circle(a, 0.5), circle(b, 0.5), segment(a, b)]);
  const d2 = circle(a, 1.32);
  const p = point(-2.17, 2.06);
  const p2 = point(-0.11, 4.57);
  const p3 = point(7.3, 6.01);
  circle(p3, 2.22);
  circle(p3, 4.73);
  circle(p3, 7.14);
  circle(p3, 11.56);
  return group(() => [__scene, segment(p, a), segment(p, a), d2, segment(p2, b), circle(p, d2.radius)]);
}
