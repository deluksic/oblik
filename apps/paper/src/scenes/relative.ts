import { circle, group, line } from "@design-scenes/geom";
import { editPoint } from "@design-scenes/euclid2";

export const sceneFile = "relative.ts";

/**
 * Stress: a handle whose arguments are expressions, not literals.
 *
 * `a` writes fine. `b` is declared as a.x+…, a.y+… — dragging it previews,
 * then pointer-up cannot patch the scene file (args are not numeric tokens).
 */
export function scene() {
  const a = editPoint(-2.2, 0.15);
  const b = editPoint(a.x + 2.4, a.y + 1.05);
  return group(() => [circle(a, 0.5), circle(b, 0.5), line(a, b)]);
}
