import { worldToScreen, type Camera } from "@design-scenes/euclid2";
import { add, mul, perp, sub, type Vec2 } from "@design-scenes/geom";

import { radiusBetween, signedOffset, type SessionHover, type ToolSession } from "./session";

const EDITOR = "#e8876a";
const SNAP = "#f0c14a";

export type GhostView =
  | { kind: "none" }
  | { kind: "point"; x: number; y: number; snapped: boolean }
  | { kind: "segment"; a: Vec2; b: Vec2; snapped: boolean }
  | { kind: "line"; origin: Vec2; dir: Vec2; snapped: boolean }
  | { kind: "ring"; origin: Vec2; r: number; snapped: boolean }
  | { kind: "offset"; origin: Vec2; dir: Vec2; d: number; snapped: boolean };

function norm(v: Vec2): Vec2 {
  const l = Math.hypot(v.x, v.y);
  if (l < 1e-9) return { x: 1, y: 0 };
  return { x: v.x / l, y: v.y / l };
}

function typedLength(session: ToolSession): number | null {
  const raw =
    session.verb === "slider"
      ? (session.value ?? "")
      : session.verb === "circle" || session.verb === "offset" || session.verb === "distance"
        ? (session.typed ?? "")
        : "";
  if (raw.trim() === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  if (session.verb === "offset" || (session.verb === "distance" && session.from?.kind === "line")) {
    return n;
  }
  return Math.max(0.05, Math.abs(n));
}

function asVec(p: { x: number; y: number }): Vec2 {
  return { x: p.x, y: p.y };
}

/**
 * What to paint for the open verb. Hover already chose point / ring / parallel;
 * this fills in endpoints and typed lengths.
 */
export function sessionGhostView(
  session: ToolSession,
  hover: SessionHover | null,
  cursor: Vec2 | null,
): GhostView {
  if (!hover || hover.ghost === "none") return { kind: "none" };
  const snap = hover.snap;
  const snapped = snap != null;
  const at = snap ? { x: snap.x, y: snap.y } : cursor;
  const typed = typedLength(session);

  if (hover.ghost === "point") {
    if (session.verb === "line" && session.a) {
      if (!at) return { kind: "none" };
      return {
        kind: "line",
        origin: asVec(session.a),
        dir: norm(sub(at, session.a)),
        snapped,
      };
    }
    if (session.verb === "perpendicular" && session.line && session.dir) {
      if (!at) return { kind: "none" };
      return {
        kind: "line",
        origin: at,
        dir: norm(perp(session.dir)),
        snapped,
      };
    }
    if (session.verb === "segment" && session.a) {
      if (!at) return { kind: "none" };
      return { kind: "segment", a: asVec(session.a), b: at, snapped };
    }
    if (!at) return { kind: "none" };
    return { kind: "point", x: at.x, y: at.y, snapped };
  }

  if (hover.ghost === "ring") {
    const origin =
      session.verb === "circle" && session.center
        ? asVec(session.center)
        : session.verb === "distance" && session.from?.kind === "point"
          ? asVec(session.from.point)
          : null;
    if (!origin) return { kind: "none" };
    const r =
      typed ??
      (snap?.kind === "distance" && snap.d != null
        ? snap.d
        : cursor
          ? radiusBetween(origin, cursor)
          : null);
    if (r == null) return { kind: "none" };
    return { kind: "ring", origin, r, snapped };
  }

  const basis =
    (session.verb === "offset" || session.verb === "distance") && session.from?.kind === "line"
      ? { origin: session.from.origin, dir: session.from.dir }
      : hover.lineBasis;
  if (!basis) return { kind: "none" };
  const d = typed ?? (cursor ? signedOffset(basis.origin, basis.dir, cursor) : null);
  if (d == null) return { kind: "none" };
  return { kind: "offset", origin: basis.origin, dir: basis.dir, d, snapped };
}

function drawInfiniteThrough(
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
  const sa = worldToScreen(cam, a, w, h);
  const sb = worldToScreen(cam, b, w, h);
  ctx.beginPath();
  ctx.moveTo(sa.x, sa.y);
  ctx.lineTo(sb.x, sb.y);
  ctx.stroke();
}

function fillDot(ctx: CanvasRenderingContext2D, cam: Camera, w: number, h: number, p: Vec2, r: number): void {
  const s = worldToScreen(cam, p, w, h);
  ctx.beginPath();
  ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
  ctx.fill();
}

export function drawGhost(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  w: number,
  h: number,
  view: GhostView,
): void {
  if (view.kind === "none") return;
  ctx.save();
  const ink = view.snapped ? SNAP : EDITOR;
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  if (view.kind === "point") {
    ctx.globalAlpha = 0.85;
    fillDot(ctx, cam, w, h, view, 6);
  } else if (view.kind === "segment") {
    const sa = worldToScreen(cam, view.a, w, h);
    const sb = worldToScreen(cam, view.b, w, h);
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sa.x, sa.y);
    ctx.lineTo(sb.x, sb.y);
    ctx.stroke();
    fillDot(ctx, cam, w, h, view.a, 5);
    fillDot(ctx, cam, w, h, view.b, 5);
  } else if (view.kind === "line") {
    drawInfiniteThrough(ctx, cam, w, h, view.origin, view.dir);
    ctx.globalAlpha = 0.85;
    fillDot(ctx, cam, w, h, view.origin, 5);
  } else if (view.kind === "ring") {
    const c = worldToScreen(cam, view.origin, w, h);
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(c.x, c.y, view.r * cam.scale, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.arc(c.x, c.y, 5, 0, Math.PI * 2);
    ctx.fill();
  } else {
    const offOrigin = add(view.origin, mul(perp(view.dir), view.d));
    ctx.globalAlpha = 0.72;
    ctx.lineWidth = 2;
    drawInfiniteThrough(ctx, cam, w, h, offOrigin, view.dir);
    drawInfiniteThrough(ctx, cam, w, h, view.origin, view.dir);
    ctx.globalAlpha = 0.85;
    fillDot(ctx, cam, w, h, view.origin, 5);
  }
  ctx.restore();
}
