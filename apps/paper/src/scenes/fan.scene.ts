import { angle, slider } from "@design-scenes/euclid2";
import { arc, circle, point, segment, type Geom, type Vec2 } from "@design-scenes/geom";

export const title = "Fan";
export const sceneFile = "fan.scene.ts";
export const hint = "Five spokes, one shared tilt. Grab any handle — all spokes follow.";
export const camera = { x: 0, y: 0.1, scale: 72 };

/** One angle call site — every spoke shares the same sweep from its rest ray. */
const spokeTilt = (hub: Vec2, from: number, reach: number) =>
  angle(hub, 28, { from, radius: reach });

function blade(hub: Vec2, dir: number, reach: number, width: number): Geom[] {
  const nx = -Math.sin(dir);
  const ny = Math.cos(dir);
  const tip: Vec2 = {
    x: hub.x + Math.cos(dir) * reach,
    y: hub.y + Math.sin(dir) * reach,
  };
  const root: Vec2 = {
    x: hub.x + Math.cos(dir) * reach * 0.12,
    y: hub.y + Math.sin(dir) * reach * 0.12,
  };
  const half = width * 0.5;
  const a: Vec2 = { x: root.x + nx * half * 0.35, y: root.y + ny * half * 0.35 };
  const b: Vec2 = { x: tip.x + nx * half, y: tip.y + ny * half };
  const c: Vec2 = { x: tip.x - nx * half, y: tip.y - ny * half };
  const d: Vec2 = { x: root.x - nx * half * 0.35, y: root.y - ny * half * 0.35 };
  return [segment(a, b), segment(b, c), segment(c, d), segment(d, a)];
}

export function scene() {
  const hub = point(0, 0);
  const reach = slider(2.35, { label: "Reach", min: 1.4, max: 3.2, step: 0.05 });
  const count = slider(5, { label: "Spokes", min: 3, max: 9, step: 1 });
  const hubR = slider(0.28, { label: "Hub", min: 0.12, max: 0.45, step: 0.02 });
  const bladeW = slider(0.42, { label: "Blade", min: 0.18, max: 0.7, step: 0.02 });

  const n = Math.max(3, Math.round(count));
  const geoms: Geom[] = [circle(hub, hubR)];

  for (let i = 0; i < n; i++) {
    const from = (i / n) * Math.PI * 2 - Math.PI / 2;
    const dir = spokeTilt(hub, from, reach);
    geoms.push(...blade(hub, dir, reach, bladeW));
    geoms.push(
      arc(hub, reach * 0.92, from, dir),
      segment(hub, {
        x: hub.x + Math.cos(from) * reach * 0.18,
        y: hub.y + Math.sin(from) * reach * 0.18,
      }),
    );
  }

  return geoms;
}
