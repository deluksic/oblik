import type { Drawable, Vec2 } from "@design-scenes/geom";
import type { Camera } from "./camera.ts";
import { worldToScreen } from "./camera.ts";
import { layoutNumberSliders } from "./hud.ts";
import type { Gizmo } from "./widgets.ts";

const COL = {
  bg: "#12141c",
  grid: "#1d2230",
  axis: "#3a4156",
  geom: "#d7d2c4",
  hover: "#f0c14a",
  selected: "#7ec8e3",
  gizmo: "#e8876a",
  gizmoFill: "#e8876a",
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
  activeGizmo: number | null,
): void {
  ctx.clearRect(0, 0, cssW, cssH);
  ctx.fillStyle = COL.bg;
  ctx.fillRect(0, 0, cssW, cssH);
  drawGrid(ctx, cssW, cssH, cam);

  for (const d of drawables) {
    const id = d.geom.id;
    const color =
      id === selectedId ? COL.selected : id === hoverId ? COL.hover : COL.geom;
    const width = id === selectedId || id === hoverId ? 2.4 : 1.5;
    strokeGeom(ctx, cam, cssW, cssH, d, color, width);
  }

  for (const g of gizmos) {
    if (g.kind === "number") continue;
    const active = g.index === activeGizmo;
    drawGizmo(ctx, cam, cssW, cssH, g, active);
  }
  drawNumberSliders(ctx, cssW, cssH, gizmos, activeGizmo);
}

function drawGrid(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  cam: Camera,
): void {
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
  } else if (g.kind === "line") {
    pathSeg(ctx, cam, w, h, g.a, g.b);
    ctx.stroke();
  } else if (g.kind === "circle") {
    const c = worldToScreen(cam, g.center, w, h);
    ctx.beginPath();
    ctx.arc(c.x, c.y, Math.abs(g.radius) * cam.scale, 0, Math.PI * 2);
    ctx.stroke();
  } else if (g.kind === "arc") {
    const c = worldToScreen(cam, g.center, w, h);
    ctx.beginPath();
    ctx.arc(
      c.x,
      c.y,
      Math.abs(g.radius) * cam.scale,
      -g.a0,
      -g.a1,
      true,
    );
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

function drawGizmo(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  w: number,
  h: number,
  g: Gizmo,
  active: boolean,
): void {
  const stroke = active ? "#fff3e6" : COL.gizmo;
  ctx.lineWidth = active ? 2.4 : 1.6;
  ctx.strokeStyle = stroke;
  ctx.fillStyle = active ? stroke : COL.gizmoFill;

  if (g.kind === "point" || g.kind === "glider") {
    const p =
      g.kind === "point"
        ? g
        : {
            x: g.a.x + (g.b.x - g.a.x) * g.t,
            y: g.a.y + (g.b.y - g.a.y) * g.t,
          };
    const s = worldToScreen(cam, p, w, h);
    ctx.beginPath();
    ctx.arc(s.x, s.y, active ? 7 : 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = COL.bg;
    ctx.lineWidth = 2;
    ctx.stroke();
    if (g.kind === "glider") {
      pathSeg(ctx, cam, w, h, g.a, g.b);
      ctx.strokeStyle = `${COL.gizmo}55`;
      ctx.lineWidth = 4;
      ctx.stroke();
    }
  } else if (g.kind === "distance") {
    const c = worldToScreen(cam, g.origin, w, h);
    ctx.beginPath();
    ctx.arc(c.x, c.y, Math.abs(g.d) * cam.scale, 0, Math.PI * 2);
    ctx.setLineDash([5, 5]);
    ctx.stroke();
    ctx.setLineDash([]);
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
    ctx.arc(s.x, s.y, active ? 7 : 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = COL.bg;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

function drawNumberSliders(
  ctx: CanvasRenderingContext2D,
  cssW: number,
  cssH: number,
  gizmos: readonly Gizmo[],
  activeGizmo: number | null,
): void {
  for (const L of layoutNumberSliders(gizmos, cssW, cssH)) {
    const active = L.gizmo.index === activeGizmo;
    const { x, y, w, h } = L.panel;
    ctx.save();
    ctx.fillStyle = active ? "#1c222c" : "#151922";
    ctx.strokeStyle = active ? COL.gizmo : COL.axis;
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
    const shown =
      L.gizmo.step >= 1 ? String(Math.round(L.gizmo.n)) : String(L.gizmo.n);
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

    ctx.fillStyle = active ? "#fff3e6" : COL.gizmoFill;
    ctx.beginPath();
    ctx.arc(L.knobX, L.knobY, active ? 8 : 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = COL.bg;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }
}
