import { circle, group, line, point } from "@design-scenes/geom";
import { editPoint, editVector } from "@design-scenes/euclid2";

export const title = "Relative";
export const sceneFile = "relative.ts";
export const hint = "Left is position. Coral arrow is the offset. b is derived.";

/**
 * `a` writes position. `d` writes the offset (dx, dy). `b` is derived, not an editor.
 */
export function scene() {
  const a = editPoint(1.24, 1.01);
  const d = editVector(a, 1.29, 2.39);
  const b = point(a.x + d.x, a.y + d.y);
  return group(() => [circle(a, 0.5), circle(b, 0.5), line(a, b)]);
}
