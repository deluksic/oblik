import {
  editDistanceToPoint,
  editNumber,
  editPoint,
  editPointOnLine,
  editPointOnSegment,
  editVector,
} from "@design-scenes/euclid2";
import { line, type Vec2 } from "@design-scenes/geom";

function stockEdges(min: Vec2, max: Vec2) {
  return {
    bottom: line(min, { x: max.x, y: min.y }),
    top: line({ x: min.x, y: max.y }, max),
    left: line(min, { x: min.x, y: max.y }),
  };
}

const cornerR = (p: Vec2) => editDistanceToPoint(p, 0.62);
const ringR = (p: Vec2) => editDistanceToPoint(p, 0.12);
const slotCapAt = (p: Vec2) => editDistanceToPoint(p, 0.32);

/**
 * Shared plate parameters — edit* live here so plate, mill, and nest panes
 * write this file, not each catalog scene.
 *
 * Corner inset: one editVector mirrored to all four corners.
 * Reused radii nest `(p) => editDistanceToPoint(p, …)` — one call site, many
 * gizmos. Pocket fillets: one editPointOnLine on each corner bisector.
 */
export function plateLayout() {
  const min = editPoint(-4.49, -3.07);
  const max = editPoint(6.17, 2.81);
  const edges = stockEdges(min, max);

  const inset = editVector(min, 1.3, 1.01);
  const ix = inset.x;
  const iy = inset.y;
  const corners: Vec2[] = [
    { x: min.x + ix, y: min.y + iy },
    { x: max.x - ix, y: min.y + iy },
    { x: max.x - ix, y: max.y - iy },
    { x: min.x + ix, y: max.y - iy },
  ];

  const cornerHoles = corners.map((center) => ({
    center,
    radius: cornerR(center),
  }));

  const bc = editPoint(0.5, -0.08);
  const pcd = editDistanceToPoint(bc, 0.46);
  const ringN = editNumber(5, {
    label: "Hole count",
    min: 3,
    max: 14,
    step: 1,
  });

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

  const pocketMin = editPoint(-1.95, -2.05);
  const pocketSpan = editVector(pocketMin, 5.48, 3.89);
  const pocketMax = {
    x: pocketMin.x + pocketSpan.x,
    y: pocketMin.y + pocketSpan.y,
  };
  const filletMax = Math.sqrt(2) * Math.min(pocketSpan.x / 2, pocketSpan.y / 2);
  const onBisector = (origin: Vec2, dir: Vec2) =>
    editPointOnLine(origin, dir, 0.85, { min: 0, max: filletMax });
  const bl = onBisector(pocketMin, { x: 1, y: 1 });
  onBisector({ x: pocketMax.x, y: pocketMin.y }, { x: -1, y: 1 });
  onBisector(pocketMax, { x: -1, y: -1 });
  onBisector({ x: pocketMin.x, y: pocketMax.y }, { x: 1, y: -1 });
  const filletR = bl.x - pocketMin.x;

  const slotCenter = editPointOnSegment(edges.top, 0.51);
  const slotLen = editDistanceToPoint(slotCenter, 1.33);
  const halfL = slotLen / 2;
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
