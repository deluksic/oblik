import { pointOnLine, pointOnSegment, slider, vector } from "@design-scenes/euclid2";
import { circle, point, segment, type Vec2 } from "@design-scenes/geom";

function stockEdges(min: Vec2, max: Vec2) {
  return {
    bottom: segment(min, { x: max.x, y: min.y }),
    top: segment({ x: min.x, y: max.y }, max),
    left: segment(min, { x: min.x, y: max.y }),
  };
}

const cornerR = (p: Vec2) => circle(p, 0.62).radius;
const ringR = (p: Vec2) => circle(p, 0.12).radius;
const slotCapAt = (p: Vec2) => circle(p, 0.32).radius;

/**
 * Shared plate parameters — constructors live here so plate, mill, and nest
 * panes write this file, not each catalog scene.
 *
 * Corner inset: one vector mirrored to all four corners.
 * Reused radii nest `(p) => circle(p, …).radius` — one call site, many
 * gizmos. Pocket fillets: one pointOnLine on each corner bisector.
 */
export function plateLayout() {
  const min = point(-4.49, -3.07);
  const max = point(6.17, 2.81);
  const edges = stockEdges(min, max);

  const inset = vector(min, 1.3, 1.01);
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

  const bc = point(0.5, -0.08);
  const pcd = circle(bc, 0.46).radius;
  const ringN = slider(5, {
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

  const pocketMin = point(-1.95, -2.05);
  const pocketSpan = vector(pocketMin, 5.48, 3.89);
  const pocketMax = {
    x: pocketMin.x + pocketSpan.x,
    y: pocketMin.y + pocketSpan.y,
  };
  const filletMax = Math.sqrt(2) * Math.min(pocketSpan.x / 2, pocketSpan.y / 2);
  const onBisector = (origin: Vec2, dir: Vec2) =>
    pointOnLine(origin, dir, 0.85, { min: 0, max: filletMax });
  const bl = onBisector(pocketMin, { x: 1, y: 1 });
  onBisector({ x: pocketMax.x, y: pocketMin.y }, { x: -1, y: 1 });
  onBisector(pocketMax, { x: -1, y: -1 });
  onBisector({ x: pocketMin.x, y: pocketMax.y }, { x: 1, y: -1 });
  const filletR = bl.x - pocketMin.x;

  const slotCenter = pointOnSegment(edges.top, 0.51);
  const slotLen = circle(slotCenter, 1.33).radius;
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
