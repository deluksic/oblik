import { pointOnSegment } from "@design-scenes/euclid2";
import { circle, point, segment } from "@design-scenes/geom";

import { assembleBeam } from "../demo/beam";

export const title = "Grouped";
export const sceneFile = "beam.scene.ts";

export function scene() {
  const a = point(-3.87, 0.16);
  const b = point(4.41, -0.23);
  const span = segment(a, b);

  const p0 = pointOnSegment(span, 0.25);
  const r0 = circle(p0, 1.29).radius;
  const p1 = pointOnSegment(span, 0.48);
  const r1 = circle(p1, 1.86).radius;
  const p2 = pointOnSegment(span, 0.75);
  const r2 = circle(p2, 1.17).radius;

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
