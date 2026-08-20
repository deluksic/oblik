import { circle, type Geom, type Vec2 } from "@design-scenes/geom";

/** Stock radius. Not a widget — the dashed handle was covering the plan. */
export const CYLINDER_RADIUS = 2.2;

export type CylinderLayout = {
  radius: number;
  ringR: number;
  centerR: number;
  ringBallR: number;
};

export function ringBalls(ringR: number): Vec2[] {
  const n = 6;
  const r = Math.max(0, ringR);
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    out.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
  }
  return out;
}

/** Top view: fixed cylinder, six ring balls, one centre ball. */
export function drawCylinderPlan(layout: CylinderLayout): Geom[] {
  return [
    circle({ x: 0, y: 0 }, layout.radius),
    circle({ x: 0, y: 0 }, layout.centerR),
    ...ringBalls(layout.ringR).map((b) => circle(b, layout.ringBallR)),
  ];
}
