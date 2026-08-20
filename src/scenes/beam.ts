import { line } from "../lib/geom.ts";
import { assembleBeam } from "../lib/mark.ts";
import {
  editDistanceToPoint,
  editPoint,
  editPointOnLine,
} from "../euclid2/widgets.ts";

export const sceneFile = "src/scenes/beam.ts";

export function scene() {
  const a = editPoint(-6.32, -1.23);
  const b = editPoint(4.73, 2.5);
  const span = line(a, b);

  // Unrolled edit* calls so pointer-up writes the right literal (one AST site per widget).
  const p0 = editPointOnLine(span, 0.25);
  const r0 = editDistanceToPoint(p0, 1.29);
  const p1 = editPointOnLine(span, 0.5);
  const r1 = editDistanceToPoint(p1, 1.54);
  const p2 = editPointOnLine(span, 0.75);
  const r2 = editDistanceToPoint(p2, 1.17);

  return assembleBeam({
    span,
    rings: [
      { post: p0, radius: r0 },
      { post: p1, radius: r1 },
      { post: p2, radius: r2 },
    ],
  });
}
