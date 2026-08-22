import { editDistanceToPoint, editPoint, editPointOnSegment } from "@design-scenes/euclid2";
import { segment } from "@design-scenes/geom";

import { assembleBeam } from "../demo/beam";

export const title = "Grouped";
export const sceneFile = "beam.scene.ts";

export function scene() {
  const a = editPoint(-3.87, 0.16);
  const b = editPoint(4.41, -0.23);
  const span = segment(a, b);

  const p0 = editPointOnSegment(span, 0.25);
  const r0 = editDistanceToPoint(p0, 1.29);
  const p1 = editPointOnSegment(span, 0.48);
  const r1 = editDistanceToPoint(p1, 1.86);
  const p2 = editPointOnSegment(span, 0.75);
  const r2 = editDistanceToPoint(p2, 1.17);

  return assembleBeam({
    span,
    hubRadius: r1,
    rings: [
      { post: p0, radius: r0 },
      { post: p1, radius: r1 },
      { post: p2, radius: r2 },
    ],
  });
}
