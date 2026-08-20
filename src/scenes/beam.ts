import { line } from "../lib/geom.ts";
import { assembleBeam } from "../lib/mark.ts";
import {
  editDistanceToPoint,
  editPoint,
  editPointOnLine,
} from "../euclid2/widgets.ts";

export const sceneFile = "src/scenes/beam.ts";

export function scene() {
  const a = editPoint(-4.12, 3.28);
  const b = editPoint(2.53, -2.27);
  const span = line(a, b);

  // Unrolled edit* calls so pointer-up writes the right literal (one AST site per widget).
  const p0 = editPointOnLine(span, 0.25);
  const r0 = editDistanceToPoint(p0, 1.2);
  const p1 = editPointOnLine(span, 0.5);
  const r1 = editDistanceToPoint(p1, 1.74);
  const p2 = editPointOnLine(span, 0.75);
  const r2 = editDistanceToPoint(p2, 2.2);

  return assembleBeam({
    span,
    rings: [
      { post: p0, radius: r0 },
      { post: p1, radius: r1 },
      { post: p2, radius: r2 },
    ],
  });
}
