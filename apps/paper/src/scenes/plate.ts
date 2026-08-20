import { line, projectT, type Vec2 } from "@design-scenes/geom";
import { boltCircle, drawPlate } from "../demo/plate.ts";
import {
  editDistanceToPoint,
  editPoint,
  editPointOnLine,
} from "@design-scenes/euclid2";

export const sceneFile = "plate.ts";

function stockEdges(min: Vec2, max: Vec2) {
  return {
    bottom: line(min, { x: max.x, y: min.y }),
    top: line({ x: min.x, y: max.y }, max),
    left: line(min, { x: min.x, y: max.y }),
  };
}

/**
 * Milled plate stress test:
 * - stock corners (2 editPoint)
 * - 4 bolt holes (4 editPoint + 1 shared drillR)
 * - polar array: center, PCD, tap Ø, count glider (library loop; N changes topology)
 * - pocket corners + fillet (2 editPoint + 1 editDistanceToPoint)
 * - slot on top edge (editPointOnLine + 2 editDistanceToPoint)
 * - demo loops over holes; pocket/slot grouped under group[0]
 */
export function plateLayout() {
  const min = editPoint(-5.5, -3.2);
  const max = editPoint(5.75, 3.22);
  const edges = stockEdges(min, max);

  const h0 = editPoint(-3.63, -1.63);
  const h1 = editPoint(4.32, -2.02);
  const h2 = editPoint(4.36, 2.22);
  const h3 = editPoint(-3.67, 1.64);
  const drillR = editDistanceToPoint(h0, 0.71);

  const bc = editPoint(0.12, -0.08);
  const pcd = editDistanceToPoint(bc, 0.7);
  const tapR = editDistanceToPoint(bc, 0.21);
  const countRail = line(
    { x: min.x - 1.2, y: min.y + 0.25 },
    { x: min.x - 1.2, y: max.y - 0.25 },
  );
  const countAt = editPointOnLine(countRail, 0.33);
  const ringN =
    3 +
    Math.round(
      Math.min(1, Math.max(0, projectT(countRail.a, countRail.b, countAt))) * 9,
    );

  const pocketMin = editPoint(-1.48, -1.06);
  const pocketMax = editPoint(2.05, 0.89);
  const filletR = editDistanceToPoint(pocketMin, 0.36);

  const slotCenter = editPointOnLine(edges.top, 0.52);
  const slotLen = editDistanceToPoint(slotCenter, 2.1);
  const slotW = editDistanceToPoint(slotCenter, 0.64);

  return {
    stock: { min, max },
    holes: [
      { center: h0, radius: drillR },
      { center: h1, radius: drillR },
      { center: h2, radius: drillR },
      { center: h3, radius: drillR },
      ...boltCircle(bc, pcd, ringN, tapR),
    ],
    pocket: { min: pocketMin, max: pocketMax, filletR },
    slot: { center: slotCenter, length: slotLen, width: slotW },
    boltCircle: { center: bc, radius: pcd, count: ringN },
  };
}

export function scene() {
  return drawPlate(plateLayout());
}
