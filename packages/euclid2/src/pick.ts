import {
  dist,
  distToArc,
  distToLine,
  distToSegment,
  type Drawable,
  type Vec2,
} from "@design-scenes/geom";

import type { Camera } from "./camera";
import { worldToScreen } from "./camera";
import { hitNumberSlider } from "./hud";
import type { Gizmo } from "./widgets";

const GIZMO_PX = 12;
const GEOM_PX = 8;

export type Hit = { target: "gizmo"; gizmo: Gizmo } | { target: "geom"; drawable: Drawable };

function geomDistWorld(world: Vec2, d: Drawable): number {
  const g = d.geom;
  if (g.kind === "point") {
    return Math.hypot(g.x - world.x, g.y - world.y);
  }
  if (g.kind === "segment") {
    return distToSegment(world, g.a, g.b);
  }
  if (g.kind === "line") {
    return distToLine(world, g.origin, g.direction);
  }
  if (g.kind === "circle") {
    return Math.abs(dist(world, g.center) - Math.abs(g.radius));
  }
  if (g.kind === "arc") {
    return distToArc(world, g.center, g.radius, g.a0, g.a1);
  }
  let min = Infinity;
  for (let i = 0; i < g.points.length - 1; i++) {
    const a = g.points[i];
    const b = g.points[i + 1];
    if (!a || !b) continue;
    min = Math.min(min, distToSegment(world, a, b));
  }
  return min;
}

export function hitTest(
  screen: Vec2,
  cam: Camera,
  width: number,
  height: number,
  gizmos: readonly Gizmo[],
  drawables: readonly Drawable[],
): Hit | null {
  const hud = hitNumberSlider(screen, width, height, gizmos);
  if (hud) return { target: "gizmo", gizmo: hud };

  const world = {
    x: cam.x + (screen.x - width / 2) / cam.scale,
    y: cam.y - (screen.y - height / 2) / cam.scale,
  };

  for (let i = gizmos.length - 1; i >= 0; i--) {
    const g = gizmos[i];
    if (!g) continue;
    if (g.kind === "point") {
      const s = worldToScreen(cam, g, width, height);
      if (Math.hypot(s.x - screen.x, s.y - screen.y) <= GIZMO_PX) {
        return { target: "gizmo", gizmo: g };
      }
    } else if (g.kind === "glider") {
      const p = {
        x: g.a.x + (g.b.x - g.a.x) * g.t,
        y: g.a.y + (g.b.y - g.a.y) * g.t,
      };
      const s = worldToScreen(cam, p, width, height);
      if (Math.hypot(s.x - screen.x, s.y - screen.y) <= GIZMO_PX) {
        return { target: "gizmo", gizmo: g };
      }
    } else if (g.kind === "lineGlider") {
      const p = {
        x: g.origin.x + g.direction.x * g.s,
        y: g.origin.y + g.direction.y * g.s,
      };
      const s = worldToScreen(cam, p, width, height);
      if (Math.hypot(s.x - screen.x, s.y - screen.y) <= GIZMO_PX) {
        return { target: "gizmo", gizmo: g };
      }
    } else if (g.kind === "offset") {
      const span = 12;
      const a = {
        x: g.origin.x - g.direction.x * span,
        y: g.origin.y - g.direction.y * span,
      };
      const b = {
        x: g.origin.x + g.direction.x * span,
        y: g.origin.y + g.direction.y * span,
      };
      const distW = distToSegment(world, a, b);
      if (distW <= GEOM_PX / cam.scale) {
        return { target: "gizmo", gizmo: g };
      }
    } else if (g.kind === "distance") {
      const radiusPx = Math.abs(g.d) * cam.scale;
      const c = worldToScreen(cam, g.origin, width, height);
      const d = Math.hypot(c.x - screen.x, c.y - screen.y);
      if (Math.abs(d - radiusPx) <= GIZMO_PX) {
        return { target: "gizmo", gizmo: g };
      }
    } else if (g.kind === "vector") {
      const tip = { x: g.origin.x + g.dx, y: g.origin.y + g.dy };
      const s = worldToScreen(cam, tip, width, height);
      if (Math.hypot(s.x - screen.x, s.y - screen.y) <= GIZMO_PX) {
        return { target: "gizmo", gizmo: g };
      }
    } else if (g.kind === "angle") {
      const rad = (g.deg * Math.PI) / 180;
      const p = {
        x: g.origin.x + Math.cos(rad) * g.radius,
        y: g.origin.y + Math.sin(rad) * g.radius,
      };
      const s = worldToScreen(cam, p, width, height);
      if (Math.hypot(s.x - screen.x, s.y - screen.y) <= GIZMO_PX) {
        return { target: "gizmo", gizmo: g };
      }
    }
  }

  let best: { drawable: Drawable; d: number } | null = null;
  const maxWorld = GEOM_PX / cam.scale;

  for (const d of drawables) {
    const distW = geomDistWorld(world, d);
    if (distW <= maxWorld && (!best || distW < best.d)) {
      best = { drawable: d, d: distW };
    }
  }

  if (best) return { target: "geom", drawable: best.drawable };
  return null;
}

/** All geometry within pick radius of `screen`, nearest first. */
export function hitsNear(
  screen: Vec2,
  cam: Camera,
  width: number,
  height: number,
  drawables: readonly Drawable[],
  maxPx = GEOM_PX,
): Drawable[] {
  const world = {
    x: cam.x + (screen.x - width / 2) / cam.scale,
    y: cam.y - (screen.y - height / 2) / cam.scale,
  };
  const maxWorld = maxPx / cam.scale;
  const out: { drawable: Drawable; d: number }[] = [];
  for (const d of drawables) {
    const distW = geomDistWorld(world, d);
    if (distW <= maxWorld) out.push({ drawable: d, d: distW });
  }
  out.sort((a, b) => a.d - b.d);
  return out.map((x) => x.drawable);
}
