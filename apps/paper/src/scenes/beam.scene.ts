import { editDistanceToPoint, editPoint, editPointOnSegment } from "@design-scenes/euclid2";
import { line } from "@design-scenes/geom";

import { assembleBeam } from "../demo/beam.ts";

export const title = "Grouped";
export const sceneFile = "beam.scene.ts";

export function scene() {
  const a = editPoint(-6.32, -1.23);
  const b = editPoint(4.73, 2.5);
  const span = line(a, b);

  const p0 = editPointOnSegment(span, 0.25);
  const r0 = editDistanceToPoint(p0, 1.29);
  const p1 = editPointOnSegment(span, 0.5);
  const r1 = editDistanceToPoint(p1, 1.54);
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
