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
  const b = editPoint(6.08, 1.35);
  const span = line(a, b);
  const post = editPointOnLine(span, 0.42);
  const height = editDistanceToPoint(post, 3.46);
  return assembleBeam({ span, post, height });
}
