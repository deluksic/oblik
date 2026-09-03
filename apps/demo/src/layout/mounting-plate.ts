import { circle, lineIntersection, parallelLine, point, region, segment } from "oblik";


const { max, min } = Math;
/** Shared plate constructors — stamp/analyze this file, not only the scene. */
export function mountingPlateLayout(ox = 0, oy = 0) {
  const origin = point(0.13 + ox, 0.25 + oy, "o_origin");
  const opp = point(3.86 + ox, 3.02 + oy, "o_opp");
  const minX = min(origin.x, opp.x);
  const maxX = max(origin.x, opp.x);
  const minY = min(origin.y, opp.y);
  const maxY = max(origin.y, opp.y);
  const bl = { x: minX, y: minY };
  const tr = { x: maxX, y: minY };
  const br = { x: maxX, y: maxY };
  const tl = { x: minX, y: maxY };
  const bottom = segment(bl, tr, "o_bot");
  const right = segment(tr, br, "o_right");
  const top = segment(br, tl, "o_top");
  const left = segment(tl, bl, "o_left");
  const hBottom = parallelLine(bottom, 0.49, "o_in");
  const hRight = parallelLine(right, hBottom.distance, "o_inr");
  const hTop = parallelLine(top, hBottom.distance, "o_int");
  const hLeft = parallelLine(left, hBottom.distance, "o_inl");
  const c0 = lineIntersection(hBottom, hLeft, "o_c0");
  const c1 = lineIntersection(hBottom, hRight, "o_c1");
  const c2 = lineIntersection(hTop, hRight, "o_c2");
  const c3 = lineIntersection(hTop, hLeft, "o_c3");
  const drill = circle(c0, 0.18, "o_drill");
  const h1 = circle(c1, drill.radius, "o_h1");
  const h2 = circle(c2, drill.radius, "o_h2");
  const h3 = circle(c3, drill.radius, "o_h3");
  const face = region([bl, bottom, tr, right, br, top, tl, left], [drill, h1, h2, h3], "o_face");
  return { origin, opp, hBottom, drill, c0, c1, c2, c3, face };
}
