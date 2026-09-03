import type { Vec2 } from "@design-scenes/geom";


const { max, min } = Math;
export type Camera = {
  x: number;
  y: number;
  scale: number;
};

export function defaultCamera(): Camera {
  return { x: 0, y: 0.6, scale: 52 };
}

export function worldToScreen(cam: Camera, p: Vec2, width: number, height: number): Vec2 {
  return {
    x: width / 2 + (p.x - cam.x) * cam.scale,
    y: height / 2 - (p.y - cam.y) * cam.scale,
  };
}

export function screenToWorld(cam: Camera, p: Vec2, width: number, height: number): Vec2 {
  return {
    x: cam.x + (p.x - width / 2) / cam.scale,
    y: cam.y - (p.y - height / 2) / cam.scale,
  };
}

export function zoomAt(
  cam: Camera,
  screen: Vec2,
  width: number,
  height: number,
  factor: number,
): Camera {
  const before = screenToWorld(cam, screen, width, height);
  const scale = min(280, max(8, cam.scale * factor));
  const next = { ...cam, scale };
  const after = screenToWorld(next, screen, width, height);
  return {
    scale,
    x: cam.x + before.x - after.x,
    y: cam.y + before.y - after.y,
  };
}
