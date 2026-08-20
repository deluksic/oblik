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
export function scene() {
  const min = editPoint(-5.5, -3.2);
  const max = editPoint(5.8, 3.5);
  const edges = stockEdges(min, max);

  const h0 = editPoint(-4.2, -2.1);
  const h1 = editPoint(4.5, -2.0);
  const h2 = editPoint(4.4, 2.3);
  const h3 = editPoint(-4.3, 2.2);
  const drillR = editDistanceToPoint(h0, 0.38);

  const pocketMin = editPoint(-1.8, -0.9);
  const pocketMax = editPoint(1.9, 1.1);
  const filletR = editDistanceToPoint(pocketMin, 0.42);

  const slotCenter = editPointOnLine(edges.top, 0.52);
  const slotLen = editDistanceToPoint(slotCenter, 2.1);
  const slotW = editDistanceToPoint(slotCenter, 0.35);

  return drawPlate({
    stock: { min, max },
    holes: [
      { center: h0, radius: drillR },
      { center: h1, radius: drillR },
      { center: h2, radius: drillR },
      { center: h3, radius: drillR },
    ],
    pocket: { min: pocketMin, max: pocketMax, filletR },
    slot: { center: slotCenter, length: slotLen, width: slotW },
  });
}
