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
