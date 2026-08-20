import { line } from "@design-scenes/geom";
import { assembleBeamFlat } from "@design-scenes/mark";
import {
  editDistanceToPoint,
  editPoint,
  editPointOnLine,
} from "@design-scenes/euclid2";

export const sceneFile = "beam-flat.ts";

/** Two trusses, no group — each handle is its own unrolled edit*. */
export function scene() {
  const aTop = editPoint(-4.72, 0.37);
  const bTop = editPoint(6.04, -1.86);
  const spanTop = line(aTop, bTop);
  const p0Top = editPointOnLine(spanTop, 0.25);
  const r0Top = editDistanceToPoint(p0Top, 3.91);
  const p1Top = editPointOnLine(spanTop, 0.5);
  const r1Top = editDistanceToPoint(p1Top, 0.34);
  const p2Top = editPointOnLine(spanTop, 0.75);
  const r2Top = editDistanceToPoint(p2Top, 1.19);
  const top = assembleBeamFlat({
    span: spanTop,
    rings: [
      { post: p0Top, radius: r0Top },
      { post: p1Top, radius: r1Top },
      { post: p2Top, radius: r2Top },
    ],
  });

  const aBot = editPoint(9.56, 4.22);
  const bBot = editPoint(-5.7, 5.92);
  const spanBot = line(aBot, bBot);
  const p0Bot = editPointOnLine(spanBot, 0.3);
  const r0Bot = editDistanceToPoint(p0Bot, 1.1);
  const p1Bot = editPointOnLine(spanBot, 0.55);
  const r1Bot = editDistanceToPoint(p1Bot, 1.5);
  const p2Bot = editPointOnLine(spanBot, 0.8);
  const r2Bot = editDistanceToPoint(p2Bot, 1.04);
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
