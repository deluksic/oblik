import { line, type Vec2 } from "@design-scenes/geom";
import {
  editDistanceToPoint,
  editNumber,
  editPoint,
  editPointOnLine,
  editPointOnSegment,
  editVector,
} from "@design-scenes/euclid2";

function stockEdges(min: Vec2, max: Vec2) {
  return {
    bottom: line(min, { x: max.x, y: min.y }),
    top: line({ x: min.x, y: max.y }, max),
    left: line(min, { x: min.x, y: max.y }),
  };
}

/**
 * Shared plate parameters — edit* live here so plate, mill, and nest panes
 * write this file, not each catalog scene.
 *
 * Corner inset: one editVector mirrored to all four corners.
 * Reused radii nest `(p) => editDistanceToPoint(p, …)` — one call site, many
 * gizmos. Pocket fillets: one editPointOnLine on each corner bisector.
 */
export function plateLayout() {
  const min = editPoint(-5.5, -3.2);
  const max = editPoint(5.75, 3.22);
  const edges = stockEdges(min, max);

  const inset = editVector(min, 1.34, 1.11);
  const ix = inset.x;
  const iy = inset.y;
  const corners: Vec2[] = [
    { x: min.x + ix, y: min.y + iy },
    { x: max.x - ix, y: min.y + iy },
    { x: max.x - ix, y: max.y - iy },
    { x: min.x + ix, y: max.y - iy },
  ];

  const cornerR = (p: Vec2) => editDistanceToPoint(p, 0.59);
  const cornerHoles = corners.map((center) => ({
    center,
    radius: cornerR(center),
  }));

  const bc = editPoint(3.73, -0.03);
  const pcd = editDistanceToPoint(bc, 1.19);
  const ringN = editNumber(5, {
    label: "Hole count",
    min: 3,
    max: 14,
    step: 1,
  });

  const ringR = (p: Vec2) => editDistanceToPoint(p, 0.22);
  const ringCount = Math.max(3, Math.round(ringN));
  const ringHoles: { center: Vec2; radius: number }[] = [];
  for (let i = 0; i < ringCount; i++) {
    const a = (i / ringCount) * Math.PI * 2 - Math.PI / 2;
    const center = {
      x: bc.x + Math.cos(a) * pcd,
      y: bc.y + Math.sin(a) * pcd,
    };
    ringHoles.push({ center, radius: ringR(center) });
  }

  const pocketMin = editPoint(-2.11, -1.52);
  const pocketSpan = editVector(pocketMin, 4.13, 2.6);
  const pocketMax = {
    x: pocketMin.x + pocketSpan.x,
    y: pocketMin.y + pocketSpan.y,
  };
  const filletMax = Math.sqrt(2) * Math.min(pocketSpan.x / 2, pocketSpan.y / 2);
  const onBisector = (origin: Vec2, dir: Vec2) =>
    editPointOnLine(origin, dir, 0.5, { min: 0, max: filletMax });
  const bl = onBisector(pocketMin, { x: 1, y: 1 });
  onBisector({ x: pocketMax.x, y: pocketMin.y }, { x: -1, y: 1 });
  onBisector(pocketMax, { x: -1, y: -1 });
  onBisector({ x: pocketMin.x, y: pocketMax.y }, { x: 1, y: -1 });
  const filletR = bl.x - pocketMin.x;

  const slotCenter = editPointOnSegment(edges.top, 0.49);
  const slotLen = editDistanceToPoint(slotCenter, 3.91);
  const halfL = slotLen / 2;
  const slotCapAt = (p: Vec2) => editDistanceToPoint(p, 0.9);
  const slotCapR = slotCapAt({
    x: slotCenter.x - halfL,
    y: slotCenter.y,
  });
  slotCapAt({ x: slotCenter.x + halfL, y: slotCenter.y });

  return {
    stock: { min, max },
    holes: [...cornerHoles, ...ringHoles],
    pocket: { min: pocketMin, max: pocketMax, filletR },
    slot: { center: slotCenter, length: slotLen, width: slotCapR * 2 },
    boltCircle: {
      center: bc,
      radius: pcd,
      count: ringN,
      holeR: ringHoles[0]?.radius ?? 0.21,
    },
  };
}
