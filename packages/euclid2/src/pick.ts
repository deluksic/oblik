import { dist, distToArc, distToSegment, type Drawable, type Vec2 } from "@design-scenes/geom";
import type { Camera } from "./camera.ts";
import { worldToScreen } from "./camera.ts";
import { hitNumberSlider } from "./hud.ts";
import type { Gizmo } from "./widgets.ts";

const GIZMO_PX = 12;
const GEOM_PX = 8;

export type Hit =
  | { target: "gizmo"; gizmo: Gizmo }
  | { target: "geom"; drawable: Drawable };

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
    const g = d.geom;
    let distW = Infinity;
    if (g.kind === "point") {
      distW = Math.hypot(g.x - world.x, g.y - world.y);
    } else if (g.kind === "line") {
      distW = distToSegment(world, g.a, g.b);
    } else if (g.kind === "circle") {
      distW = Math.abs(dist(world, g.center) - Math.abs(g.radius));
    } else if (g.kind === "arc") {
      distW = distToArc(world, g.center, g.radius, g.a0, g.a1);
    } else {
      let min = Infinity;
      for (let i = 0; i < g.points.length - 1; i++) {
        const a = g.points[i];
        const b = g.points[i + 1];
        if (!a || !b) continue;
        min = Math.min(min, distToSegment(world, a, b));
      }
      distW = min;
    }
    if (distW <= maxWorld && (!best || distW < best.d)) {
      best = { drawable: d, d: distW };
    }
  }

  if (best) return { target: "geom", drawable: best.drawable };
  return null;
}
