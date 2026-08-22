import { editDistanceToPoint, editOffsetFromLine, editPoint } from "@design-scenes/euclid2";
import {
  lineIntersection,
  offsetLine,
  point,
  segment,
  type Vec2,
} from "@design-scenes/geom";

/**
 * Shared mounting-plate parameters — edit* live here so pair scene reuses inset and holeR.
 */
export function mountingPlateLayout() {
  const origin = editPoint(0, 0);
  const opp = editPoint(4, 3);
  const bl: Vec2 = point(Math.min(origin.x, opp.x), Math.min(origin.y, opp.y));
  const tr: Vec2 = point(Math.max(origin.x, opp.x), Math.min(origin.y, opp.y));
  const tl: Vec2 = point(Math.min(origin.x, opp.x), Math.max(origin.y, opp.y));

  const bottom = segment(bl, tr);
  const left = segment(tl, bl);

  const inset = editOffsetFromLine(bottom, 0.45);
  const hBottom = offsetLine(bottom, inset);
  const hLeft = offsetLine(left, inset);

  const c0 = lineIntersection(hBottom, hLeft)!;
  const holeR = editDistanceToPoint(c0, 0.18);

  return { origin, opp, inset, holeR };
}
