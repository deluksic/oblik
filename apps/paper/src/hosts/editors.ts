import { dist, type Vec2 } from "@design-scenes/geom";
import { worldToScreen, type Camera } from "@design-scenes/euclid2";
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
    hint: "Dashed ring. A point in scene(), then a radius.",
  },
];

export type EditorTool =
  | { id: "point" }
  | {
      id: "distance";
      origin?: { x: number; y: number; widgetIndex?: number };
    };

const EDITOR = "#e8876a";

export function editorStatus(tool: EditorTool | null, fallback: string): string {
  if (!tool) return fallback;
  if (tool.id === "point") return "Click to place a point · Esc cancels";
  if (!tool.origin) {
    return "Click a point in this scene, or empty paper for a new origin · Esc cancels";
  }
  return "Click to set the dashed radius · Esc cancels";
}

export function radiusBetween(a: Vec2, b: Vec2): number {
  return Math.max(0.05, dist(a, b));
}

export function drawEditorGhost(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  w: number,
  h: number,
  tool: EditorTool,
  cursor: Vec2 | null,
): void {
  if (!cursor && !(tool.id === "distance" && tool.origin)) return;
  ctx.save();
  ctx.strokeStyle = EDITOR;
  ctx.fillStyle = EDITOR;
  if (tool.id === "point" && cursor) {
    const s = worldToScreen(cam, cursor, w, h);
    ctx.beginPath();
    ctx.arc(s.x, s.y, 6, 0, Math.PI * 2);
    ctx.globalAlpha = 0.85;
    ctx.fill();
  } else if (tool.id === "distance") {
    const origin = tool.origin;
    if (origin) {
      const r = cursor ? radiusBetween(origin, cursor) : 0.2;
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
    } else if (cursor) {
      const s = worldToScreen(cam, cursor, w, h);
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}
