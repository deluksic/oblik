import { line } from "../lib/geom.ts";
import { assembleBeamFlat } from "../lib/mark.ts";
import {
  editDistanceToPoint,
  editPoint,
  editPointOnLine,
} from "../euclid2/widgets.ts";

export const sceneFile = "src/scenes/beam-flat.ts";

/** Two trusses, no group — edit* must be unrolled (one literal per handle). */
export function scene() {
  const aTop = editPoint(-4.12, 3.28);
  const bTop = editPoint(2.53, -2.27);
  const spanTop = line(aTop, bTop);
  const p0Top = editPointOnLine(spanTop, 0.25);
  const r0Top = editDistanceToPoint(p0Top, 3.91);
  const p1Top = editPointOnLine(spanTop, 0.5);
  const r1Top = editDistanceToPoint(p1Top, 0.34);
  const p2Top = editPointOnLine(spanTop, 0.75);
  const r2Top = editDistanceToPoint(p2Top, 1.9);
  const top = assembleBeamFlat({
    span: spanTop,
    rings: [
      { post: p0Top, radius: r0Top },
      { post: p1Top, radius: r1Top },
      { post: p2Top, radius: r2Top },
    ],
  });

  const aBot = editPoint(8.11, 0.43);
  const bBot = editPoint(1.37, 6.27);
  const spanBot = line(aBot, bBot);
  const p0Bot = editPointOnLine(spanBot, 0.3);
  const r0Bot = editDistanceToPoint(p0Bot, 1.1);
  const p1Bot = editPointOnLine(spanBot, 0.55);
  const r1Bot = editDistanceToPoint(p1Bot, 1.5);
  const p2Bot = editPointOnLine(spanBot, 0.8);
  const r2Bot = editDistanceToPoint(p2Bot, 1.9);
  const bottom = assembleBeamFlat({
    span: spanBot,
    rings: [
      { post: p0Bot, radius: r0Bot },
      { post: p1Bot, radius: r1Bot },
      { post: p2Bot, radius: r2Bot },
    ],
  });

  return [...top, ...bottom];
}
