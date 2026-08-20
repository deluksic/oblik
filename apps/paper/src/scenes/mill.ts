import { line3 } from "@design-scenes/geom";
import { drawMill } from "../demo/mill.ts";
import {
  editDistance3,
  editPoint3,
  editPointOnLine3,
} from "@design-scenes/euclid3";

export const view = "euclid3" as const;
export const sceneFile = "mill.ts";

/**
 * 3D mill block:
 * - stock min/max corners (editPoint3)
 * - 4 bolt holes, shared drill Ø (loop in demo)
 * - pocket as a box in the top face
 * - slot along the +Y top edge (glider + length + width)
 */
export function scene() {
  const min = editPoint3(-5.4, -3.1, 0);
  const max = editPoint3(5.6, 3.2, 1.45);

  const h0 = editPoint3(-4.1, -2.0, 1.45);
  const h1 = editPoint3(4.3, -2.05, 1.45);
  const h2 = editPoint3(4.25, 2.15, 1.45);
  const h3 = editPoint3(-4.15, 2.1, 1.45);
  const drillR = editDistance3(h0, 0.42);

  const pocketMin = editPoint3(-1.7, -0.85, 0.85);
  const pocketMax = editPoint3(1.8, 0.9, 1.45);

  const topEdge = line3(
    { x: min.x, y: max.y, z: max.z },
    { x: max.x, y: max.y, z: max.z },
  );
  const slotAt = editPointOnLine3(topEdge, 0.5);
  const slotLen = editDistance3(slotAt, 2.2);
  const slotW = editDistance3(slotAt, 0.45);

  return drawMill({
    stock: { min, max },
    holes: [
      { x: h0.x, y: h0.y, radius: drillR },
      { x: h1.x, y: h1.y, radius: drillR },
      { x: h2.x, y: h2.y, radius: drillR },
      { x: h3.x, y: h3.y, radius: drillR },
    ],
    pocket: { min: pocketMin, max: pocketMax },
    slot: {
      center: slotAt,
      length: slotLen,
      width: slotW,
      depth: 0.35,
    },
  });
}
