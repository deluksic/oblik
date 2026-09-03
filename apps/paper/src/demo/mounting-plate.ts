import {
  circle,
  line,
  lineIntersection,
  offsetLine,
  segment,
  type Geom,
  type Line,
  type Vec2,
} from "@design-scenes/geom";


const { max, min } = Math;
export type MountingPlateCorners = {
  /** Bottom-left and top-right edit corners (any diagonal pair). */
  origin: Vec2;
  opp: Vec2;
  inset: number;
  holeR: number;
};

function aabbCorners(origin: Vec2, opp: Vec2) {
  const minX = min(origin.x, opp.x);
  const maxX = max(origin.x, opp.x);
  const minY = min(origin.y, opp.y);
  const maxY = max(origin.y, opp.y);
  return {
    bl: { x: minX, y: minY },
    tr: { x: maxX, y: minY },
    br: { x: maxX, y: maxY },
    tl: { x: minX, y: maxY },
  };
}

/** Pure plate outline + four corner holes from shared inset and drill radius. */
export function drawMountingPlate(opts: MountingPlateCorners): Geom[] {
  const { bl, tr, br, tl } = aabbCorners(opts.origin, opts.opp);
  const bottom = segment(bl, tr);
  const right = segment(tr, br);
  const top = segment(br, tl);
  const left = segment(tl, bl);

  const hBottom = offsetLine(bottom, opts.inset).line;
  const hRight = offsetLine(right, opts.inset).line;
  const hTop = offsetLine(top, opts.inset).line;
  const hLeft = offsetLine(left, opts.inset).line;

  const c0 = lineIntersection(hBottom, hLeft);
  const c1 = lineIntersection(hBottom, hRight);
  const c2 = lineIntersection(hTop, hRight);
  const c3 = lineIntersection(hTop, hLeft);

  return [
    bottom,
    right,
    top,
    left,
    hBottom,
    hRight,
    hTop,
    hLeft,
    circle(c0, opts.holeR),
    circle(c1, opts.holeR),
    circle(c2, opts.holeR),
    circle(c3, opts.holeR),
  ];
}

/** Two plates sharing inset and hole radius; only origins differ. */
export function drawMountingPlatePair(
  master: MountingPlateCorners,
  secondOrigin: Vec2,
): Geom[] {
  const dx = secondOrigin.x - master.origin.x;
  const dy = secondOrigin.y - master.origin.y;
  const second: MountingPlateCorners = {
    origin: secondOrigin,
    opp: { x: master.opp.x + dx, y: master.opp.y + dy },
    inset: master.inset,
    holeR: master.holeR,
  };
  return [...drawMountingPlate(master), ...drawMountingPlate(second)];
}

/** Center of an axis-aligned rectangle from two diagonal corners. */
export function rectCenter(origin: Vec2, opp: Vec2): Vec2 {
  return { x: (origin.x + opp.x) / 2, y: (origin.y + opp.y) / 2 };
}

/** Infinite diagonals through opposite corners — for a center hole. */
export function rectDiagonals(origin: Vec2, opp: Vec2): [Line, Line] {
  const { bl, tr, br, tl } = aabbCorners(origin, opp);
  return [line(bl, br), line(tr, tl)];
}

export function centerHole(origin: Vec2, opp: Vec2, holeR: number): Geom | null {
  const [d1, d2] = rectDiagonals(origin, opp);
  const c = lineIntersection(d1, d2);
  if (!Number.isFinite(c.x) || !Number.isFinite(c.y)) return null;
  return circle(c, holeR);
}
