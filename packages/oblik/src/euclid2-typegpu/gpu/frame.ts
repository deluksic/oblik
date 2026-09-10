import { tgpu } from "typegpu";
import { f32, vec2f } from "typegpu/data";

import type { Camera2, PaneSize } from "../../euclid2/camera";
import { Frame, type FrameValue } from "./schemas";

export const DASH_A_PX = 5;
export const DASH_B_PX = 4;

/** AA skirt the fill quads are grown by, in CSS px: a fragment's ramp needs the
 * quad to reach past the silhouette, and the vertex shader applies it so the
 * stored AABB stays pure world geometry (see `worldPerPx`). */
export const QUAD_PAD_PX = 2;

export function makeFrameValue(
  cam: Camera2,
  size: PaneSize,
  dpr: number,
  opts?: { dash?: { a: number; b: number }; knockoutPx?: number; outlinePx?: number },
): FrameValue {
  return Frame({
    cam: vec2f(cam.x, cam.y),
    scale: cam.scale,
    pane: vec2f(size.w, size.h),
    dpr,
    dash: vec2f(opts?.dash?.a ?? DASH_A_PX, opts?.dash?.b ?? DASH_B_PX),
    knockoutPx: opts?.knockoutPx ?? 4,
    outlinePx: opts?.outlinePx ?? 7,
  });
}

/** World units per CSS pixel at the given zoom. */
export function pxToWorld(px: number, scale: number): number {
  return px / scale;
}

/** The GPU twin of `pxToWorld`, and the one conversion every record width goes
 * through: widths are stored in CSS px (see `schemas.ts`) so that zooming moves
 * the frame uniform instead of rewriting the records — one `scale` write
 * reprojects the whole world, chrome included. */
export const worldPerPx = tgpu.fn(
  [f32],
  f32,
)((scale) => {
  "use gpu";
  return 1 / scale;
});
