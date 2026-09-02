import { worldToScreen, type Camera2, type PaneSize } from "../euclid2/camera";

export type FigureFrame = { width: number; height: number; x?: number; y?: number };

export type FrameRect = { x: number; y: number; w: number; h: number };

export type FrameScreenRect = { left: number; top: number; width: number; height: number };

export type FrameXywh = { x: number; y: number; width: number; height: number };

export const FRAME_MIN_SIZE = 0.25;

/** Drag the frame by a world-space delta. */
export function frameMoved(
  start: FrameXywh,
  from: { x: number; y: number },
  to: { x: number; y: number },
): FrameXywh {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return { ...start, x: start.x + dx, y: start.y + dy };
}

/** Resize from a fixed min corner (x, y) toward a dragged max corner. */
export function frameResized(
  anchor: { x: number; y: number },
  corner: { x: number; y: number },
  min = FRAME_MIN_SIZE,
): FrameXywh {
  return {
    x: anchor.x,
    y: anchor.y,
    width: Math.max(min, corner.x - anchor.x),
    height: Math.max(min, corner.y - anchor.y),
  };
}

/**
 * Axis-aligned artboard in world units. When the frame carries an explicit
 * `x`/`y` (min corner, y-up), it is used directly; otherwise the artboard is
 * centered on the camera look-at.
 */
export function frameRect(
  frame: FigureFrame | undefined,
  look: { x: number; y: number } | undefined,
): FrameRect | null {
  if (!frame || !(frame.width > 0) || !(frame.height > 0)) return null;
  if (frame.x != null && frame.y != null) {
    return { x: frame.x, y: frame.y, w: frame.width, h: frame.height };
  }
  const cx = look?.x ?? frame.width / 2;
  const cy = look?.y ?? frame.height / 2;
  return { x: cx - frame.width / 2, y: cy - frame.height / 2, w: frame.width, h: frame.height };
}

/** Pane-pixel box of a world-space frame. Y-up world maps to Y-down screen. */
export function pageScreenRect(page: FrameRect, cam: Camera2, size: PaneSize): FrameScreenRect {
  const a = worldToScreen({ x: page.x, y: page.y }, cam, size);
  const b = worldToScreen({ x: page.x + page.w, y: page.y + page.h }, cam, size);
  const left = Math.min(a.x, b.x);
  const top = Math.min(a.y, b.y);
  return { left, top, width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
}
