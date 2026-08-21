import { editDistanceToPoint, editPoint, editPointOnSegment } from "@design-scenes/euclid2";
import { line } from "@design-scenes/geom";

import { assembleBeamFlat } from "../demo/beam.ts";

export const id = "flat";
export const title = "Flat";
export const sceneFile = "beam-flat.scene.ts";

/** Two trusses, no group — each handle is its own unrolled edit*. */
export function scene() {
  const aTop = editPoint(-4.72, 0.37);
  const bTop = editPoint(5.89, 1.09);
  const spanTop = line(aTop, bTop);
  const p0Top = editPointOnSegment(spanTop, 0.25);
  const r0Top = editDistanceToPoint(p0Top, 1.18);
  const p1Top = editPointOnSegment(spanTop, 0.49);
  const r1Top = editDistanceToPoint(p1Top, 2.59);
  const p2Top = editPointOnSegment(spanTop, 0.75);
  const r2Top = editDistanceToPoint(p2Top, 1.33);
  const top = assembleBeamFlat({
    span: spanTop,
    rings: [
      { post: p0Top, radius: r0Top },
      { post: p1Top, radius: r1Top },
      { post: p2Top, radius: r2Top },
    ],
  });

  const aBot = editPoint(9.56, 4.22);
  const bBot = editPoint(-1.26, 6.95);
  const spanBot = line(aBot, bBot);
  const p0Bot = editPointOnSegment(spanBot, 0.3);
  const r0Bot = editDistanceToPoint(p0Bot, 1.24);
  const p1Bot = editPointOnSegment(spanBot, 0.55);
  const r1Bot = editDistanceToPoint(p1Bot, 1.62);
  const p2Bot = editPointOnSegment(spanBot, 0.8);
  const r2Bot = editDistanceToPoint(p2Bot, 1);
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
