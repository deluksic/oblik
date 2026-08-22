import { pointOnSegment } from "@design-scenes/euclid2";
import { circle, point, segment } from "@design-scenes/geom";

import { assembleBeamFlat } from "../demo/beam";

export const id = "flat";
export const title = "Flat";
export const sceneFile = "beam-flat.scene.ts";

/** Two trusses, no group — each handle is its own unrolled constructor. */
export function scene() {
  const aTop = point(-4.88, 2.49);
  const bTop = point(5.89, 1.09);
  const spanTop = segment(aTop, bTop);
  const p0Top = pointOnSegment(spanTop, 0.25);
  const r0Top = circle(p0Top, 1.18).radius;
  const p1Top = pointOnSegment(spanTop, 0.51);
  const r1Top = circle(p1Top, 3.3).radius;
  const p2Top = pointOnSegment(spanTop, 0.75);
  const r2Top = circle(p2Top, 1.33).radius;
  const top = assembleBeamFlat({
    span: spanTop,
    rings: [
      { post: p0Top, radius: r0Top },
      { post: p1Top, radius: r1Top },
      { post: p2Top, radius: r2Top },
    ],
  });

  const aBot = point(9.56, 4.22);
  const bBot = point(-1.26, 6.95);
  const spanBot = segment(aBot, bBot);
  const p0Bot = pointOnSegment(spanBot, 0.27);
  const r0Bot = circle(p0Bot, 1.24).radius;
  const p1Bot = pointOnSegment(spanBot, 0.55);
  const r1Bot = circle(p1Bot, 1.62).radius;
  const p2Bot = pointOnSegment(spanBot, 0.8);
  const r2Bot = circle(p2Bot, 1).radius;
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
