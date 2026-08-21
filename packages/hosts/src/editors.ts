import { worldToScreen, type Camera, type Gizmo } from "@design-scenes/euclid2";
import { dist, type Vec2 } from "@design-scenes/geom";
import type { CommandSpec } from "@design-scenes/shell";

export const EDITOR_COMMANDS: CommandSpec[] = [
  {
    id: "point",
    title: "Point",
    hint: "Click empty paper.",
  },
  {
    id: "distance",
    title: "Distance",
    hint: "Dashed ring. Pick a named point, then a radius.",
  },
];

export const GEOM_CONSTRUCTOR_COMMANDS: CommandSpec[] = [
  {
    id: "circle",
    title: "Circle",
    hint: "Named editPoint, then any named editDistanceToPoint ring.",
  },
  {
    id: "line",
    title: "Line",
    hint: "Two named points.",
  },
];

export type NamedGizmoPick = {
  name: string;
  x: number;
  y: number;
  at?: { file: string; line: number; column: number };
};

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
      center?: NamedGizmoPick;
      hoverRadius?: number;
    }
  | {
      id: "line";
      a?: NamedGizmoPick;
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

function slot(label: string, extraClass = "", state: "active" | "pending" = "active"): string {
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
      hint: "Click empty paper.",
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
    const center = tool.center ? filled(tool.center.name) : slot("<point>");
    const distance = slot("<distance>", "", tool.center ? "active" : "pending");
    return {
      previewHtml: fn("circle", [center, distance]),
      hint: tool.center
        ? "Click a named dashed ring (any origin)."
        : "Click a named editPoint.",
    };
  }
  const a = tool.a ? filled(tool.a.name) : slot("<a>");
  const b = slot("<b>", "", tool.a ? "active" : "pending");
  return {
    previewHtml: fn("line", [a, b]),
    hint: tool.a ? "Click a second named point." : "Click a named point.",
  };
}

export function editorStatus(tool: EditorTool | null, fallback: string): string {
  if (!tool) return fallback;
  return commandPreview(tool)?.hint ?? fallback;
}

export function radiusBetween(a: Vec2, b: Vec2): number {
  return Math.max(0.05, dist(a, b));
}

export type GhostSnap = {
  kind: "point" | "distance";
  x: number;
  y: number;
  d?: number;
};

export function drawEditorGhost(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  w: number,
  h: number,
  tool: EditorTool,
  cursor: Vec2 | null,
  snap: GhostSnap | null = null,
): void {
  const raw = tool.id === "distance" && tool.origin ? (tool.typedRadius?.trim() ?? "") : "";
  const typedNum = raw === "" ? NaN : Number(raw);
  const typed = Number.isFinite(typedNum) ? Math.max(0.05, typedNum) : null;
  if (!cursor && !(tool.id === "distance" && tool.origin && typed != null)) {
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
            ? radiusBetween(origin, snap ?? cursor)
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
        snap?.kind === "distance" && snap.d != null
          ? snap.d
          : (tool.hoverRadius ?? (cursor ? radiusBetween(center, cursor) : 0.2));
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
  } else if (tool.id === "line") {
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
  }
  ctx.restore();
}

export function distanceHoverRadius(tool: EditorTool, gizmo: Gizmo | null): number | undefined {
  if (tool.id !== "circle" || !tool.center || !gizmo || gizmo.kind !== "distance") {
    return undefined;
  }
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
