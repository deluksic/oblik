import { circle, type Geom, type Vec2 } from "@design-scenes/geom";

/** Stock radius. Not a widget — the dashed handle was covering the plan. */
export const CYLINDER_RADIUS = 2.2;

export type PackCell = {
  origin: Vec2;
  /** World yaw of this cell’s quatrefoil. */
  rotation: number;
};

/**
 * Six equal circles around one of the same size: centre-to-centre is 2R.
 * Surrounding cells rotate with their polar angle.
 */
export function pack7(radius: number): PackCell[] {
  const cells: PackCell[] = [{ origin: { x: 0, y: 0 }, rotation: 0 }];
  for (const origin of polarRing(6, 2 * radius)) {
    cells.push({ origin, rotation: Math.atan2(origin.y, origin.x) });
  }
  return cells;
}

export type CylinderLayout = {
  radius: number;
  ringR: number;
  centerR: number;
  ringBallR: number;
};

export function polarRing(
  count: number,
  ringR: number,
  rotation = 0,
): Vec2[] {
  const n = Math.max(1, Math.round(count));
  const r = Math.max(0, ringR);
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2 + rotation;
    out.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
  }
  return out;
}

/** Quatrefoil: four balls on a ring, optionally rotated. */
export function ringBalls(ringR: number, rotation = 0): Vec2[] {
  return polarRing(4, ringR, rotation);
}

function dimples(
  origin: Vec2,
  layout: CylinderLayout,
  rotation: number,
): Geom[] {
  return [
    circle(origin, layout.centerR),
    ...ringBalls(layout.ringR, rotation).map((b) =>
      circle({ x: origin.x + b.x, y: origin.y + b.y }, layout.ringBallR),
    ),
  ];
}

/** Top view: seven cylinders (fixed hex pack) with a rotated quatrefoil on each. */
export function drawCylinderPlan(layout: CylinderLayout): Geom[] {
  return pack7(layout.radius).flatMap((c) => [
    circle(c.origin, layout.radius),
    ...dimples(c.origin, layout, c.rotation),
  ]);
}
