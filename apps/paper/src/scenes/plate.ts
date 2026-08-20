import { line, type Vec2 } from "@design-scenes/geom";
import { drawPlate } from "../demo/plate.ts";
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
 * - pocket corners + fillet (2 editPoint + 1 editDistanceToPoint)
 * - slot on top edge (editPointOnLine + 2 editDistanceToPoint)
 * - demo loops over holes; pocket/slot grouped under group[0]
 */
export function plateLayout() {
  const min = editPoint(-5.5, -3.2);
  const max = editPoint(5.8, 3.5);
  const edges = stockEdges(min, max);

  const h0 = editPoint(-4.29, -1.86);
  const h1 = editPoint(4.46, -2.13);
  const h2 = editPoint(4.4, 2.3);
  const h3 = editPoint(-4.3, 2.2);
  const drillR = editDistanceToPoint(h0, 1.82);

  const pocketMin = editPoint(-1.99, -1.43);
  const pocketMax = editPoint(2.02, 1.03);
  const filletR = editDistanceToPoint(pocketMin, 0.32);

  const slotCenter = editPointOnLine(edges.top, 0.52);
  const slotLen = editDistanceToPoint(slotCenter, 1.58);
  const slotW = editDistanceToPoint(slotCenter, 0.5);

  return {
    stock: { min, max },
    holes: [
      { center: h0, radius: drillR },
      { center: h1, radius: drillR },
      { center: h2, radius: drillR },
      { center: h3, radius: drillR },
    ],
    pocket: { min: pocketMin, max: pocketMax, filletR },
    slot: { center: slotCenter, length: slotLen, width: slotW },
  };
}

export function scene() {
  return drawPlate(plateLayout());
}
