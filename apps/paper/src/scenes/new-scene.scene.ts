import { editPoint, editDistanceToPoint, editOffsetFromLine } from "@design-scenes/euclid2";
import { group, line, lineIntersection } from "@design-scenes/geom";

export const title = "New Scene";
export const view = "euclid2" as const;
export const sceneFile = "new-scene.scene.ts";

export function scene() {
  const p = editPoint(-0.03, -0.01);
  const p2 = editPoint(4.39, 4.1);
  const l = line(p, p2);
  const off = editOffsetFromLine(l, 0.76);
  const off2 = editOffsetFromLine(l, 5);
  const p3 = editPoint(0.91, 3.33);
  const p4 = editPoint(0.73, 4.91);
  const l2 = line(p4, p3);
  const x = lineIntersection(l2, l);
  const x2 = lineIntersection(l2, l);
  return group(() => [l, l2]);
}
