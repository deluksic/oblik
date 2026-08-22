import { pointOnSegment } from "@design-scenes/euclid2";
import { circle, point, segment } from "@design-scenes/geom";

import { assembleBeam } from "../demo/beam";

export const id = "shared";
export const title = "Shared radius";
export const sceneFile = "beam-shared.scene.ts";

/** One radius literal feeds every ring and the roof hub. */
export function scene() {
  const a = point(-6.85, 3.83);
  const b = point(5.71, 3.24);
  const span = segment(a, b);

  const p0 = pointOnSegment(span, 0.25);
  const p1 = pointOnSegment(span, 0.5);
  const p2 = pointOnSegment(span, 0.75);
  const r = circle(p1, 1.33).radius;

  return assembleBeam({
    span,
    hubRadius: r,
    rings: [
      { post: p0, radius: r },
      { post: p1, radius: r },
      { post: p2, radius: r },
    ],
  });
}
