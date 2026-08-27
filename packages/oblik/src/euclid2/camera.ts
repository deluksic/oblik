export type Camera2 = { x: number; y: number; scale: number };

export type PaneSize = { w: number; h: number };

export function kWorldToNdc(cam: Camera2, size: PaneSize): number {
  return (2 * cam.scale) / Math.max(1, size.h);
}

export function worldToNdc(
  world: { x: number; y: number },
  cam: Camera2,
  size: PaneSize,
): { x: number; y: number } {
  const k = kWorldToNdc(cam, size);
  return { x: k * (world.x - cam.x), y: -k * (world.y - cam.y) };
}

export function ndcToWorld(ndc: { x: number; y: number }, cam: Camera2, size: PaneSize): { x: number; y: number } {
  const k = kWorldToNdc(cam, size);
  return { x: cam.x + ndc.x / k, y: cam.y - ndc.y / k };
}

export const SCALE_MIN = 8;
export const SCALE_MAX = 280;

/** Screen-space gizmos. Y-down pixels; 1 unit = 1 CSS pixel when the HUD viewBox matches the pane. */
export function worldToScreen(
  world: { x: number; y: number },
  cam: Camera2,
  size: PaneSize,
): { x: number; y: number } {
  return {
    x: size.w / 2 + (world.x - cam.x) * cam.scale,
    y: size.h / 2 - (world.y - cam.y) * cam.scale,
  };
}

export function screenToWorld(
  screen: { x: number; y: number },
  cam: Camera2,
  size: PaneSize,
): { x: number; y: number } {
  return {
    x: cam.x + (screen.x - size.w / 2) / cam.scale,
    y: cam.y - (screen.y - size.h / 2) / cam.scale,
  };
}

/** Zoom so the world point under `screen` stays under `screen`. */
export function zoomAt(
  cam: Camera2,
  screen: { x: number; y: number },
  size: PaneSize,
  factor: number,
): Camera2 {
  const before = screenToWorld(screen, cam, size);
  const scale = Math.min(SCALE_MAX, Math.max(SCALE_MIN, cam.scale * factor));
  const next = { ...cam, scale };
  const after = screenToWorld(screen, next, size);
  return {
    scale,
    x: cam.x + before.x - after.x,
    y: cam.y + before.y - after.y,
  };
}

export function clientToNdc(
  client: { x: number; y: number },
  rect: DOMRect,
  size: PaneSize,
): { x: number; y: number } {
  const aspect = size.w / Math.max(1, size.h);
  const nx = ((client.x - rect.left) / Math.max(1, rect.width)) * 2 * aspect - aspect;
  const ny = ((client.y - rect.top) / Math.max(1, rect.height)) * 2 - 1;
  return { x: nx, y: ny };
}

export function viewBox(size: PaneSize): string {
  const aspect = size.w / Math.max(1, size.h);
  return `${-aspect} -1 ${2 * aspect} 2`;
}

export function infiniteClip(
  origin: { x: number; y: number },
  dir: { x: number; y: number },
  cam: Camera2,
  size: PaneSize,
): { a: { x: number; y: number }; b: { x: number; y: number } } {
  const span = Math.max(size.w, size.h) / cam.scale + Math.hypot(cam.x, cam.y) + 8;
  return {
    a: { x: origin.x - dir.x * span, y: origin.y - dir.y * span },
    b: { x: origin.x + dir.x * span, y: origin.y + dir.y * span },
  };
}
