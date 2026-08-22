import { worldToScreen, type Camera, type Gizmo } from "@design-scenes/euclid2";
import { add, dist, dot, mul, perp, sub, type Vec2 } from "@design-scenes/geom";
import type { CommandSpec } from "@design-scenes/shell";

export const EDITOR_COMMANDS: CommandSpec[] = [
  {
    id: "point",
    title: "Point",
    hint: "Click empty paper or a line crossing.",
  },
  {
    id: "distance",
    title: "Distance",
    hint: "Point or line, then a length (ring or dashed parallel).",
  },
];

export const LINE_COMMAND: CommandSpec = {
  id: "line",
  title: "Line",
  hint: "Two points — infinite line. Then Distance can offset it.",
};

export const GEOM_CONSTRUCTOR_COMMANDS: CommandSpec[] = [];

export type NamedGizmoPick = {
  name: string;
  x: number;
  y: number;
  at?: { file: string; line: number; column: number };
};

export type EndpointPick = NamedGizmoPick | Vec2;

export function isNamedPick(p: EndpointPick): p is NamedGizmoPick {
  return "name" in p && typeof (p as NamedGizmoPick).name === "string";
}

export function endpointLabel(p: EndpointPick): string {
  return isNamedPick(p) ? p.name : `${p.x}, ${p.y}`;
}

export type EditorTool =
  | { id: "point" }
  | {
      id: "distance";
      origin?: {
        x: number;
        y: number;
        name?: string;
        at?: { line: number; column: number };
      };
      typedRadius?: string;
    }
  | {
      id: "circle";
      center?: EndpointPick;
      hoverRadius?: number;
      typedRadius?: string;
    }
  | {
      id: "segment";
      a?: EndpointPick;
    }
  | {
      id: "infiniteLine";
      a?: EndpointPick;
    }
  | {
      id: "rect";
      a?: EndpointPick;
    }
  | {
      id: "offset";
      base?: string;
      baseLine?: { origin: Vec2; dir: Vec2 };
      typedDistance?: string;
      reuseInset?: string;
    };

const EDITOR = "#e8876a";
const SNAP = "#f0c14a";

function escapeHtml(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function slotHtml(label: string, extraClass = ""): string {
  const cls = extraClass ? `slot ${extraClass}` : "slot";
  const attr = extraClass.includes("is-number") ? ` data-placeholder="${escapeHtml(label)}"` : "";
  return `<span class="${cls}"${attr}>${escapeHtml(label)}</span>`;
}

function arg(content: string, state: "active" | "done" | "pending"): string {
  return `<span class="arg arg-${state}">${content}</span>`;
}

function slot(label: string, extraClass = "", state: "active" | "pending" | "done" = "active"): string {
  return arg(slotHtml(label, extraClass), state);
}

function filled(text: string): string {
  return arg(escapeHtml(text), "done");
}

function fn(name: string, args: string[]): string {
  const body = args
    .map((argHtml, i) => (i === 0 ? argHtml : `<span class="cmd-punct">, </span>${argHtml}`))
    .join("");
  return `<span class="cmd-name">${escapeHtml(name)}</span><span class="cmd-punct">(</span>${body}<span class="cmd-punct">)</span>`;
}

export type CommandPreview = {
  previewHtml: string;
  acceptNumber?: boolean;
  hint?: string;
};

export function commandPreview(tool: EditorTool | null): CommandPreview | null {
  if (!tool) return null;
  if (tool.id === "point") {
    return {
      previewHtml: fn("editPoint", [slot("<x>"), slot("<y>")]),
      hint: "Click empty paper or a line crossing.",
    };
  }
  if (tool.id === "distance") {
    if (!tool.origin) {
      return {
        previewHtml: fn("editDistanceToPoint", [
          slot("<point>"),
          slot("<radius>", "", "pending"),
        ]),
        hint: "Click a named point, or empty paper for a new origin.",
      };
    }
    const point = tool.origin.name ? filled(tool.origin.name) : slot("<point>", "", "done");
    const radiusLabel = tool.typedRadius?.trim() ? tool.typedRadius : "<radius>";
    return {
      previewHtml: fn("editDistanceToPoint", [point, slot(radiusLabel, "is-number")]),
      acceptNumber: true,
      hint: "Type a radius and Enter, or click the canvas.",
    };
  }
  if (tool.id === "circle") {
    const center = tool.center ? filled(endpointLabel(tool.center)) : slot("<point>");
    const radiusLabel = tool.typedRadius?.trim() ? tool.typedRadius : "<radius>";
    const distance = tool.center
      ? slot(radiusLabel, "is-number")
      : slot("<radius>", "", "pending");
    return {
      previewHtml: fn("circle", [center, distance]),
      acceptNumber: Boolean(tool.center),
      hint: tool.center
        ? "Type a radius and Enter, click the canvas, or pick a dashed ring."
        : "Click a point handle or empty paper for the center.",
    };
  }
  if (tool.id === "segment") {
    const a = tool.a ? filled(endpointLabel(tool.a)) : slot("<a>");
    const b = slot("<b>", "", tool.a ? "active" : "pending");
    return {
      previewHtml: fn("segment", [a, b]),
      hint: tool.a ? "Click the second point." : "Click the first point.",
    };
  }
  if (tool.id === "infiniteLine") {
    const a = tool.a ? filled(endpointLabel(tool.a)) : slot("<a>");
    const b = slot("<b>", "", tool.a ? "active" : "pending");
    return {
      previewHtml: fn("line", [a, b]),
      hint: tool.a ? "Click the second point." : "Click the first point.",
    };
  }
  if (tool.id === "rect") {
    const a = tool.a ? filled(endpointLabel(tool.a)) : slot("<a>");
    const b = slot("<b>", "", tool.a ? "active" : "pending");
    return {
      previewHtml: fn("rect", [a, b]),
      hint: tool.a
        ? "Click the opposite corner."
        : "Click the first corner (snaps to world 0,0).",
    };
  }
  if (tool.id === "offset") {
    if (tool.reuseInset && tool.base) {
      return {
        previewHtml: fn("offsetLine", [filled(tool.base), filled(tool.reuseInset)]),
        hint: "Click a side line to offset with the reused inset.",
      };
    }
    if (tool.reuseInset) {
      return {
        previewHtml: fn("offsetLine", [slot("<line>"), filled(tool.reuseInset)]),
        hint: "Click a segment or line.",
      };
    }
    const line = tool.base ? filled(tool.base) : slot("<line>");
    if (!tool.base) {
      return {
        previewHtml: fn("offsetLine", [
          line,
          fn("editOffsetFromLine", [slot("<line>", "", "pending"), slot("<distance>", "", "pending")]),
        ]),
        hint: "Click a segment or line, or an offset gizmo to reuse.",
      };
    }
    const distanceLabel = tool.typedDistance?.trim() ? tool.typedDistance : "<distance>";
    return {
      previewHtml: fn("offsetLine", [
        line,
        fn("editOffsetFromLine", [line, slot(distanceLabel, "is-number")]),
      ]),
      acceptNumber: true,
      hint: "Type a distance and Enter, click inward, or pick an offset gizmo to reuse.",
    };
  }
  return null;
}

export function editorStatus(tool: EditorTool | null, fallback: string): string {
  if (!tool) return fallback;
  return commandPreview(tool)?.hint ?? fallback;
}

export function radiusBetween(a: Vec2, b: Vec2): number {
  return Math.max(0.05, dist(a, b));
}

export type GhostSnap = {
  kind: "point" | "distance" | "intersection";
  x: number;
  y: number;
  d?: number;
  intersection?: { a: string; b: string };
};

function drawInfiniteThrough(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  w: number,
  h: number,
  origin: Vec2,
  dir: Vec2,
  dashed: boolean,
): void {
  const span = Math.max(w, h) / cam.scale + Math.hypot(cam.x, cam.y) + 20;
  const a = { x: origin.x - dir.x * span, y: origin.y - dir.y * span };
  const b = { x: origin.x + dir.x * span, y: origin.y + dir.y * span };
  const sa = worldToScreen(cam, a, w, h);
  const sb = worldToScreen(cam, b, w, h);
  if (dashed) ctx.setLineDash([8, 6]);
  ctx.beginPath();
  ctx.moveTo(sa.x, sa.y);
  ctx.lineTo(sb.x, sb.y);
  ctx.stroke();
  if (dashed) ctx.setLineDash([]);
}

export function drawEditorGhost(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  w: number,
  h: number,
  tool: EditorTool,
  cursor: Vec2 | null,
  snap: GhostSnap | null = null,
  lineHover = false,
): void {
  const raw =
    tool.id === "distance" && tool.origin
      ? (tool.typedRadius?.trim() ?? "")
      : tool.id === "circle" && tool.center
        ? (tool.typedRadius?.trim() ?? "")
        : tool.id === "offset"
          ? (tool.typedDistance?.trim() ?? "")
          : "";
  const typedNum = raw === "" ? NaN : Number(raw);
  const typed = Number.isFinite(typedNum) ? Math.max(0.05, typedNum) : null;
  if (
    !cursor &&
    !(tool.id === "distance" && tool.origin && typed != null) &&
    !(tool.id === "circle" && tool.center && typed != null) &&
    !(tool.id === "offset" && tool.baseLine && (typed != null || tool.reuseInset))
  ) {
    return;
  }
  ctx.save();
  const ink = snap ? SNAP : EDITOR;
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  if (tool.id === "point") {
    const p = snap ?? cursor;
    if (p) {
      const s = worldToScreen(cam, p, w, h);
      ctx.beginPath();
      ctx.arc(s.x, s.y, 6, 0, Math.PI * 2);
      ctx.globalAlpha = 0.85;
      ctx.fill();
    }
  } else if (tool.id === "distance") {
    const origin = tool.origin;
    if (origin) {
      const r =
        typed ??
        (snap?.kind === "distance" && snap.d != null
          ? snap.d
          : cursor
            ? radiusBetween(origin, cursor)
            : 0.2);
      const c = worldToScreen(cam, origin, w, h);
      ctx.setLineDash([5, 5]);
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(c.x, c.y, r * cam.scale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(c.x, c.y, 5, 0, Math.PI * 2);
      ctx.fill();
    } else if (snap ?? cursor) {
      const p = snap ?? cursor!;
      const s = worldToScreen(cam, p, w, h);
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 6, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (tool.id === "circle") {
    const center = tool.center;
    if (center) {
      const r =
        typed ??
        (snap?.kind === "distance" && snap.d != null
          ? snap.d
          : (tool.hoverRadius ?? (cursor ? radiusBetween(center, snap ?? cursor) : 0.2)));
      const c = worldToScreen(cam, center, w, h);
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(c.x, c.y, r * cam.scale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(c.x, c.y, 5, 0, Math.PI * 2);
      ctx.globalAlpha = 0.85;
      ctx.fill();
    } else if (snap ?? cursor) {
      const p = snap ?? cursor!;
      const s = worldToScreen(cam, p, w, h);
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 6, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (tool.id === "segment") {
    const a = tool.a;
    const end = snap ?? cursor;
    if (a && end) {
      const sa = worldToScreen(cam, a, w, h);
      const sb = worldToScreen(cam, end, w, h);
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sa.x, sa.y);
      ctx.lineTo(sb.x, sb.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(sa.x, sa.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(sb.x, sb.y, 5, 0, Math.PI * 2);
      ctx.fill();
    } else if (end) {
      const s = worldToScreen(cam, end, w, h);
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 6, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (tool.id === "infiniteLine") {
    const a = tool.a;
    const end = snap ?? cursor;
    if (a && end) {
      const dir = norm(sub(end, a));
      drawInfiniteThrough(ctx, cam, w, h, a, dir, true);
      ctx.globalAlpha = 0.85;
      const sa = worldToScreen(cam, a, w, h);
      ctx.beginPath();
      ctx.arc(sa.x, sa.y, 5, 0, Math.PI * 2);
      ctx.fill();
    } else if (end) {
      const s = worldToScreen(cam, end, w, h);
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 6, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (tool.id === "rect") {
    const a = tool.a;
    const end = snap ?? cursor;
    if (a && end) {
      const origin = isNamedPick(a) ? { x: a.x, y: a.y } : a;
      const tl = { x: Math.min(origin.x, end.x), y: Math.max(origin.y, end.y) };
      const br = { x: Math.max(origin.x, end.x), y: Math.min(origin.y, end.y) };
      const tr = { x: br.x, y: tl.y };
      const bl = { x: tl.x, y: br.y };
      const pts = [tl, tr, br, bl, tl];
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = 2;
      ctx.beginPath();
      pts.forEach((p, i) => {
        const s = worldToScreen(cam, p, w, h);
        if (i === 0) ctx.moveTo(s.x, s.y);
        else ctx.lineTo(s.x, s.y);
      });
      ctx.stroke();
      for (const p of [origin, end]) {
        const s = worldToScreen(cam, p, w, h);
        ctx.beginPath();
        ctx.arc(s.x, s.y, 5, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (end) {
      const s = worldToScreen(cam, end, w, h);
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 6, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (tool.id === "offset") {
    const line = tool.baseLine;
    if (line) {
      const d =
        tool.reuseInset != null
          ? typed
          : (typed ??
            (cursor ? dot(sub(cursor, line.origin), perp(line.dir)) : null));
      if (d != null) {
        const offOrigin = add(line.origin, mul(perp(line.dir), d));
        ctx.globalAlpha = 0.72;
        ctx.lineWidth = 2;
        drawInfiniteThrough(ctx, cam, w, h, offOrigin, line.dir, true);
      }
      drawInfiniteThrough(ctx, cam, w, h, line.origin, line.dir, false);
      ctx.globalAlpha = 0.85;
      const s = worldToScreen(cam, line.origin, w, h);
      ctx.beginPath();
      ctx.arc(s.x, s.y, 5, 0, Math.PI * 2);
      ctx.fill();
    } else if (cursor && !tool.base) {
      // Picking a base line — segment hover is handled by drawFrame.
    } else if (cursor && !lineHover) {
      const s = worldToScreen(cam, cursor, w, h);
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function norm(v: Vec2): Vec2 {
  const l = Math.hypot(v.x, v.y);
  if (l < 1e-9) return { x: 1, y: 0 };
  return { x: v.x / l, y: v.y / l };
}

export function distanceHoverRadius(tool: EditorTool, gizmo: Gizmo | null): number | undefined {
  if (tool.id !== "circle" || !tool.center || !gizmo || gizmo.kind !== "distance") {
    return undefined;
  }
  const center = tool.center;
  if (gizmo.origin.x !== center.x || gizmo.origin.y !== center.y) return undefined;
  return gizmo.d;
}

export function gizmoWorldPoint(g: Gizmo): Vec2 | null {
  if (g.kind === "point") return { x: g.x, y: g.y };
  if (g.kind === "vector") return { x: g.origin.x + g.dx, y: g.origin.y + g.dy };
  if (g.kind === "glider") {
    return {
      x: g.a.x + (g.b.x - g.a.x) * g.t,
      y: g.a.y + (g.b.y - g.a.y) * g.t,
    };
  }
  if (g.kind === "lineGlider") {
    return {
      x: g.origin.x + g.direction.x * g.s,
      y: g.origin.y + g.direction.y * g.s,
    };
  }
  return null;
}
