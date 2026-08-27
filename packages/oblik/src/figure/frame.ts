export type FigureFrame = { width: number; height: number };

export type FrameRect = { x: number; y: number; w: number; h: number };

/** Axis-aligned artboard in world units, centered on the camera look-at. */
export function frameRect(
  frame: FigureFrame | undefined,
  look: { x: number; y: number } | undefined,
): FrameRect | null {
  if (!frame || !(frame.width > 0) || !(frame.height > 0)) return null;
  const cx = look?.x ?? frame.width / 2;
  const cy = look?.y ?? frame.height / 2;
  return { x: cx - frame.width / 2, y: cy - frame.height / 2, w: frame.width, h: frame.height };
}
