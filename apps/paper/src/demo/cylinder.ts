import { circle, type Geom, type Vec2 } from "@design-scenes/geom";

/** Stock radius. Not a widget — the dashed handle was covering the plan. */
export const CYLINDER_RADIUS = 2.2;

/**
 * Six equal circles around one of the same size: centre-to-centre is 2R.
 * Not a widget. Independent of the quatrefoil dimple count.
 */
export function pack7(radius: number): Vec2[] {
  return [{ x: 0, y: 0 }, ...polarRing(6, 2 * radius)];
}

export type CylinderLayout = {
  radius: number;
  ringR: number;
  centerR: number;
  ringBallR: number;
};

export function polarRing(count: number, ringR: number): Vec2[] {
  const n = Math.max(1, Math.round(count));
  const r = Math.max(0, ringR);
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    out.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
  }
  return out;
}

/** Quatrefoil: four balls on a ring. */
export function ringBalls(ringR: number): Vec2[] {
  return polarRing(4, ringR);
}

function dimples(origin: Vec2, layout: CylinderLayout): Geom[] {
  return [
    circle(origin, layout.centerR),
    ...ringBalls(layout.ringR).map((b) =>
      circle({ x: origin.x + b.x, y: origin.y + b.y }, layout.ringBallR),
    ),
  ];
}

/** Top view: seven cylinders (fixed hex pack) with the same dimple on each. */
export function drawCylinderPlan(layout: CylinderLayout): Geom[] {
  const cells = pack7(layout.radius);
  return cells.flatMap((c) => [circle(c, layout.radius), ...dimples(c, layout)]);
}
