import { editPoint, editVector, editDistanceToPoint } from "@design-scenes/euclid2";
import { circle, group, line, point } from "@design-scenes/geom";

export const title = "Relative";
export const sceneFile = "relative.scene.ts";
export const hint = "Left is position. Coral arrow is the offset. b is derived.";

/**
 * `a` writes position. `d` writes the offset (dx, dy). `b` is derived, not an editor.
 */
export function scene() {
  const a = editPoint(0.38, 0.13);
  const d = editVector(a, 2.14, 1.93);
  const b = point(a.x + d.x, a.y + d.y);
  const __scene = group(() => [circle(a, 0.5), circle(b, 0.5), line(a, b)]);
  const d2 = editDistanceToPoint(a, 1.32);
  const p = editPoint(-2.17, 2.06);
  const p2 = editPoint(-0.11, 4.57);
  const p3 = editPoint(7.3, 6.01);
  editDistanceToPoint(p3, 2.22);
  editDistanceToPoint(p3, 4.73);
  editDistanceToPoint(p3, 7.14);
  editDistanceToPoint(p3, 11.56);
  return group(() => [__scene, line(p, a), line(p, a), circle(a, d2), line(p2, b), circle(p, d2)]);
}
