import { line } from "@design-scenes/geom";
import { assembleBeam } from "@design-scenes/mark";
import {
  editDistanceToPoint,
  editPoint,
  editPointOnLine,
} from "@design-scenes/euclid2";

export const sceneFile = "beam-shared.ts";

/** One radius literal feeds every ring and the roof hub. */
export function scene() {
  const a = editPoint(-6.32, -1.23);
  const b = editPoint(4.73, 2.5);
  const span = line(a, b);

  const p0 = editPointOnLine(span, 0.25);
  const p1 = editPointOnLine(span, 0.5);
  const p2 = editPointOnLine(span, 0.75);
  const r = editDistanceToPoint(p1, 1.54);

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
