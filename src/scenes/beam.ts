import { line } from "../lib/geom.ts";
import { assembleBeam } from "../lib/mark.ts";
import {
  editDistanceToPoint,
  editPoint,
  editPointOnLine,
} from "../euclid2/widgets.ts";

export const sceneFile = "src/scenes/beam.ts";

export function scene() {
  const a = editPoint(-4, 0);
  const b = editPoint(4, 0.45);
  const span = line(a, b);
  const post = editPointOnLine(span, 0.34);
  const height = editDistanceToPoint(a, 1.7);
  return assembleBeam({ span, post, height });
}
