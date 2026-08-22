import type { Drawable, Vec2 } from "@design-scenes/geom";

import type { Camera } from "./camera";
import { worldToScreen } from "./camera";
import { layoutNumberSliders } from "./hud";
import { handleOwnsInk } from "./ink";
import type { Gizmo } from "./widgets";

const COL = {
  bg: "#12141c",
  grid: "#1d2230",
  axis: "#3a4156",
  geom: "#d7d2c4",
  hover: "#f0c14a",
  selected: "#7ec8e3",
  gizmo: "#e8876a",
  gizmoHot: "#fff3e6",
};

export function resizeCanvas(canvas: HTMLCanvasElement): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.floor(rect.width * dpr));
  const h = Math.max(1, Math.floor(rect.height * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext("2d");
  if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

export function drawFrame(
  ctx: CanvasRenderingContext2D,
  cssW: number,
  cssH: number,
  cam: Camera,
  drawables: readonly Drawable[],
  gizmos: readonly Gizmo[],
  hoverId: string | null,
  selectedId: string | null,
  hoverGizmo: string | null,
  selectedGizmo: string | null,
): void {
  ctx.clearRect(0, 0, cssW, cssH);
  ctx.fillStyle = COL.bg;
  ctx.fillRect(0, 0, cssW, cssH);
  drawGrid(ctx, cssW, cssH, cam);

  for (const d of drawables) {
    if (handleOwnsInk(d.geom)) continue;
    const id = d.geom.id;
    const color = id === selectedId ? COL.selected : id === hoverId ? COL.hover : COL.geom;
    const width = id === selectedId || id === hoverId ? 2.4 : 1.5;
    strokeGeom(ctx, cam, cssW, cssH, d, color, width);
  }

  for (const g of gizmos) {
    if (g.kind === "number") continue;
    drawGizmo(ctx, cam, cssW, cssH, g, gizmoInk(g.site, hoverGizmo, selectedGizmo));
  }
}

/** Gizmos only — for 2D SDF scenes that paint the field themselves. */
export function drawGizmoOverlay(
  ctx: CanvasRenderingContext2D,
  cssW: number,
  cssH: number,
  cam: Camera,
  gizmos: readonly Gizmo[],
  hoverGizmo: string | null,
  selectedGizmo: string | null,
): void {
  for (const g of gizmos) {
    if (g.kind === "number") continue;
    drawGizmo(ctx, cam, cssW, cssH, g, gizmoInk(g.site, hoverGizmo, selectedGizmo));
  }
}

/** HUD last so in-progress ghosts do not cover sliders. */
export function drawNumberHud(
  ctx: CanvasRenderingContext2D,
  cssW: number,
  cssH: number,
  gizmos: readonly Gizmo[],
  hoverGizmo: string | null,
  selectedGizmo: string | null,
): void {
  drawNumberSliders(ctx, cssW, cssH, gizmos, hoverGizmo, selectedGizmo);
}

function gizmoInk(
  site: string,
  hover: string | null,
  selected: string | null,
): { color: string; hot: boolean } {
  if (site === selected) return { color: COL.selected, hot: true };
  if (site === hover) return { color: COL.gizmoHot, hot: true };
  return { color: COL.gizmo, hot: false };
}

function drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number, cam: Camera): void {
  const step = cam.scale;
  const origin = worldToScreen(cam, { x: 0, y: 0 }, w, h);

  ctx.beginPath();
  ctx.strokeStyle = COL.grid;
  ctx.lineWidth = 1;
  const x0 = origin.x % step;
  for (let x = x0; x < w; x += step) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
  }
  const y0 = origin.y % step;
  for (let y = y0; y < h; y += step) {
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
  }
  ctx.stroke();

  ctx.beginPath();
  ctx.strokeStyle = COL.axis;
  ctx.lineWidth = 1.25;
  ctx.moveTo(0, origin.y);
  ctx.lineTo(w, origin.y);
  ctx.moveTo(origin.x, 0);
  ctx.lineTo(origin.x, h);
  ctx.stroke();
}

function strokeGeom(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  w: number,
  h: number,
  d: Drawable,
  color: string,
  lineWidth: number,
): void {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const g = d.geom;
  if (g.kind === "point") {
    const s = worldToScreen(cam, g, w, h);
    ctx.beginPath();
    ctx.arc(s.x, s.y, 3.5, 0, Math.PI * 2);
    ctx.fill();
  } else if (g.kind === "segment") {
    pathSeg(ctx, cam, w, h, g.a, g.b);
    ctx.stroke();
  } else if (g.kind === "line") {
    pathInfiniteLine(ctx, cam, w, h, g.origin, g.direction);
    ctx.stroke();
  } else if (g.kind === "circle") {
    const c = worldToScreen(cam, g.center, w, h);
    ctx.beginPath();
    ctx.arc(c.x, c.y, Math.abs(g.radius) * cam.scale, 0, Math.PI * 2);
    ctx.stroke();
  } else if (g.kind === "arc") {
    const c = worldToScreen(cam, g.center, w, h);
    ctx.beginPath();
    ctx.arc(c.x, c.y, Math.abs(g.radius) * cam.scale, -g.a0, -g.a1, true);
    ctx.stroke();
  } else {
    if (g.points.length < 2) return;
    ctx.beginPath();
    g.points.forEach((p, i) => {
      const s = worldToScreen(cam, p, w, h);
      if (i === 0) ctx.moveTo(s.x, s.y);
      else ctx.lineTo(s.x, s.y);
    });
    ctx.stroke();
  }
}

function pathSeg(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  w: number,
  h: number,
  a: Vec2,
  b: Vec2,
): void {
  const sa = worldToScreen(cam, a, w, h);
  const sb = worldToScreen(cam, b, w, h);
  ctx.beginPath();
  ctx.moveTo(sa.x, sa.y);
  ctx.lineTo(sb.x, sb.y);
}

function pathInfiniteLine(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  w: number,
  h: number,
  origin: Vec2,
  dir: Vec2,
): void {
  const span = Math.max(w, h) / cam.scale + Math.hypot(cam.x, cam.y) + 20;
  const a = { x: origin.x - dir.x * span, y: origin.y - dir.y * span };
  const b = { x: origin.x + dir.x * span, y: origin.y + dir.y * span };
  pathSeg(ctx, cam, w, h, a, b);
}

function drawGizmo(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  w: number,
  h: number,
  g: Gizmo,
  ink: { color: string; hot: boolean },
): void {
  const { color, hot } = ink;
  ctx.lineWidth = hot ? 2.4 : 1.6;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;

  if (g.kind === "point" || g.kind === "glider" || g.kind === "lineGlider") {
    const p =
      g.kind === "point"
        ? g
        : g.kind === "glider"
          ? {
              x: g.a.x + (g.b.x - g.a.x) * g.t,
              y: g.a.y + (g.b.y - g.a.y) * g.t,
            }
          : {
              x: g.origin.x + g.direction.x * g.s,
              y: g.origin.y + g.direction.y * g.s,
            };
    const s = worldToScreen(cam, p, w, h);
    ctx.beginPath();
    ctx.arc(s.x, s.y, hot ? 7 : 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = COL.bg;
    ctx.lineWidth = 2;
    ctx.stroke();
    if (g.kind === "glider") {
      pathSeg(ctx, cam, w, h, g.a, g.b);
      ctx.strokeStyle = `${COL.gizmo}55`;
      ctx.lineWidth = 4;
      ctx.stroke();
    } else if (g.kind === "lineGlider") {
      const s0 = g.min ?? 0;
      const s1 = g.max ?? s0 + 4;
      const tail = {
        x: g.origin.x + g.direction.x * s0,
        y: g.origin.y + g.direction.y * s0,
      };
      const head = {
        x: g.origin.x + g.direction.x * s1,
        y: g.origin.y + g.direction.y * s1,
      };
      pathSeg(ctx, cam, w, h, tail, head);
      ctx.strokeStyle = `${COL.gizmo}99`;
      ctx.lineWidth = 1.25;
      ctx.stroke();
    }
  } else if (g.kind === "distance") {
    const c = worldToScreen(cam, g.origin, w, h);
    ctx.beginPath();
    ctx.arc(c.x, c.y, Math.abs(g.d) * cam.scale, 0, Math.PI * 2);
    ctx.stroke();
  } else if (g.kind === "angle") {
    const rad = (g.deg * Math.PI) / 180;
    const tip = {
      x: g.origin.x + Math.cos(rad) * g.radius,
      y: g.origin.y + Math.sin(rad) * g.radius,
    };
    pathSeg(ctx, cam, w, h, g.origin, tip);
    ctx.stroke();
    const c = worldToScreen(cam, g.origin, w, h);
    ctx.beginPath();
    ctx.arc(c.x, c.y, Math.abs(g.radius) * 0.38 * cam.scale, 0, -rad, true);
    ctx.stroke();
    const s = worldToScreen(cam, tip, w, h);
    ctx.beginPath();
    ctx.arc(s.x, s.y, hot ? 7 : 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = COL.bg;
    ctx.lineWidth = 2;
    ctx.stroke();
  } else if (g.kind === "vector") {
    const tip = { x: g.origin.x + g.dx, y: g.origin.y + g.dy };
    pathSeg(ctx, cam, w, h, g.origin, tip);
    ctx.stroke();
    const s = worldToScreen(cam, tip, w, h);
    ctx.beginPath();
    ctx.arc(s.x, s.y, hot ? 7 : 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = COL.bg;
    ctx.lineWidth = 2;
    ctx.stroke();
  } else if (g.kind === "offset") {
    pathInfiniteLine(ctx, cam, w, h, g.origin, g.direction);
    ctx.strokeStyle = color;
    ctx.lineWidth = hot ? 2.2 : 1.6;
    ctx.stroke();
  }
}

function drawNumberSliders(
  ctx: CanvasRenderingContext2D,
  cssW: number,
  cssH: number,
  gizmos: readonly Gizmo[],
  hoverGizmo: string | null,
  selectedGizmo: string | null,
): void {
  for (const L of layoutNumberSliders(gizmos, cssW, cssH)) {
    const ink = gizmoInk(L.gizmo.site, hoverGizmo, selectedGizmo);
    const { x, y, w, h } = L.panel;
    ctx.save();
    ctx.fillStyle = ink.hot ? "#1c222c" : "#151922";
    ctx.strokeStyle = ink.hot ? ink.color : COL.axis;
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") {
      ctx.roundRect(x, y, w, h, 8);
    } else {
      ctx.rect(x, y, w, h);
    }
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = COL.gizmo;
    ctx.font = "600 10px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(L.gizmo.label.toUpperCase(), x + 14, y + 18);

    ctx.fillStyle = COL.geom;
    ctx.textAlign = "right";
    ctx.font = "600 13px ui-monospace, monospace";
    const shown = L.gizmo.step >= 1 ? String(Math.round(L.gizmo.n)) : String(L.gizmo.n);
    ctx.fillText(shown, x + w - 14, y + 18);

    ctx.fillStyle = "#2a3040";
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") {
      ctx.roundRect(L.track.x, L.track.y, L.track.w, L.track.h, 3);
    } else {
      ctx.rect(L.track.x, L.track.y, L.track.w, L.track.h);
    }
    ctx.fill();

    ctx.fillStyle = `${COL.gizmo}55`;
    ctx.beginPath();
    const filled = Math.max(0, L.knobX - L.track.x);
    if (typeof ctx.roundRect === "function") {
      ctx.roundRect(L.track.x, L.track.y, filled, L.track.h, 3);
    } else {
      ctx.rect(L.track.x, L.track.y, filled, L.track.h);
    }
    ctx.fill();

    ctx.fillStyle = ink.color;
    ctx.beginPath();
    ctx.arc(L.knobX, L.knobY, ink.hot ? 8 : 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = COL.bg;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }
}
