import { editPoint, editDistanceToPoint, editOffsetFromLine } from "@design-scenes/euclid2";
import { line, lineIntersection, offsetLine } from "@design-scenes/geom";

export const title = "New Scene";
export const view = "euclid2" as const;
export const sceneFile = "new-scene.scene.ts";

export function scene() {
  const p = editPoint(0.52, 1.78);
  const p2 = editPoint(5.07, -0.01);
  const p3 = editPoint(2.67, 4.58);
  const l = line(p, p3);
  line(p2, p);
  const off = editOffsetFromLine(l, -2.51);
}
