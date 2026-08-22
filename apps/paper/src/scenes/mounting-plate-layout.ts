import {
  circle,
  lineIntersection,
  offsetLine,
  point,
  segment,
  type Vec2,
} from "@design-scenes/geom";

/**
 * Shared mounting-plate parameters — constructors live here so the pair
 * scene reuses inset and holeR.
 */
export function mountingPlateLayout() {
  const origin = point(0.13, 0.25);
  const opp = point(3.86, 3.02);
  const bl: Vec2 = point(Math.min(origin.x, opp.x), Math.min(origin.y, opp.y));
  const tr: Vec2 = point(Math.max(origin.x, opp.x), Math.min(origin.y, opp.y));
  const tl: Vec2 = point(Math.min(origin.x, opp.x), Math.max(origin.y, opp.y));

  const bottom = segment(bl, tr);
  const left = segment(tl, bl);

  const insetOff = offsetLine(bottom, 0.49);
  const inset = insetOff.distance;
  const hBottom = insetOff.line;
  const hLeft = offsetLine(left, inset).line;

  const c0 = lineIntersection(hBottom, hLeft);
  const holeR = circle(c0, 0.18).radius;

  return { origin, opp, inset, holeR };
}
