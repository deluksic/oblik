import { line } from "../lib/geom.ts";
import { assembleBeamFlat } from "../lib/mark.ts";
import {
  editDistanceToPoint,
  editPoint,
  editPointOnLine,
} from "../euclid2/widgets.ts";

export const sceneFile = "src/scenes/beam-flat.ts";

function truss(span: ReturnType<typeof line>, t0: number, t1: number, t2: number) {
  const p0 = editPointOnLine(span, t0);
  const r0 = editDistanceToPoint(p0, 3.91);
  const p1 = editPointOnLine(span, t1);
  const r1 = editDistanceToPoint(p1, 1.22);
  const p2 = editPointOnLine(span, t2);
  const r2 = editDistanceToPoint(p2, 1.9);
  return assembleBeamFlat({
    span,
    rings: [
      { post: p0, radius: r0 },
      { post: p1, radius: r1 },
      { post: p2, radius: r2 },
    ],
  });
}

/** Two trusses, no group — paths are global; ids are uuids. */
export function scene() {
  const aTop = editPoint(-4.12, 3.28);
  const bTop = editPoint(2.53, -2.27);
  const top = truss(line(aTop, bTop), 0.25, 0.5, 0.75);

  const aBot = editPoint(8.78, 2.26);
  const bBot = editPoint(3.03, 4.45);
  const bottom = truss(line(aBot, bBot), 0.3, 0.55, 0.8);

  return [...top, ...bottom];
}
