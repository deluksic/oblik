import { line } from "@design-scenes/geom";
import { assembleBeam } from "../demo/beam.ts";
import {
  editDistanceToPoint,
  editPoint,
  editPointOnLine,
} from "@design-scenes/euclid2";

export const id = "shared";
export const title = "Shared radius";
export const sceneFile = "beam-shared.ts";

/** One radius literal feeds every ring and the roof hub. */
export function scene() {
  const a = editPoint(-6.85, 3.83);
  const b = editPoint(5.71, 3.24);
  const span = line(a, b);

  const p0 = editPointOnLine(span, 0.25);
  const p1 = editPointOnLine(span, 0.5);
  const p2 = editPointOnLine(span, 0.75);
  const r = editDistanceToPoint(p1, 1.33);

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
