/**
 * The vertex shader: **the camera is applied to the anchor only.**
 *
 * Glyph's built-in vertex shader is
 * `clip = M · (glyphLocalPixels + position)`, which puts the camera and the
 * glyph's own pixels in one matrix. An affine matrix cannot translate a point
 * while scaling the displacements around it, so with that shader a world-anchored
 * label is impossible and every label has to be re-projected on the CPU whenever
 * the camera moves.
 *
 * This shader splits the two:
 *
 *     clip = worldToClip · anchor  +  (glyphPx + unit) · zoom · pixel
 *
 * The first term is the anchor under the camera — the only thing a pan changes,
 * and it changes as one uniform. The second is the glyph's own quad, scaled by
 * the zoom (it is world geometry, so it must scale) and then mapped by a
 * camera-free pixel→clip vector. A pan therefore writes one small uniform and
 * touches no instance buffer.
 *
 * The mapping was verified against the pane's own `worldToScreen`: the anchor
 * lands exactly, and the quad scales correctly, at several cameras and zooms.
 */
import { tgpu } from "typegpu";
import { f32, u32, vec2f, vec4f } from "typegpu/data";
import { max, select } from "typegpu/std";

import {
  OblikMsdfInstance,
  OblikMsdfVertexOutput,
  OblikScene,
  type OblikMsdfInstance as Instance,
} from "./instance";

/** Uniform block: the camera and the knockout band's appearance. */
export const oblikSceneLayout = tgpu.bindGroupLayout({
  scene: { uniform: OblikScene },
});

/**
 * Unit-quad corner from a vertex index: 0,1 top-left/right; 2,3 bottom-left/
 * right; 4,5 the extra pair the six-vertex quad uses.
 */
const corner = tgpu.fn(
  [u32],
  vec2f,
)((index) => {
  "use gpu";
  const x = select(0, 1, index === 1 || index === 4 || index === 5);
  const y = select(0, 1, index === 2 || index === 3 || index === 5);
  return vec2f(f32(x), f32(y));
});

/**
 * One glyph vertex. `scene.worldToClip` maps the anchor; `scene.pixel` plus
 * `zoom` place the glyph's own quad in screen space.
 */
export const oblikVertex = tgpu.fn(
  [OblikMsdfInstance, u32, OblikScene],
  OblikMsdfVertexOutput,
)((instance: Instance, vertexIndex: number, scene) => {
  "use gpu";
  const unit = corner(u32(vertexIndex));

  // The glyph's paragraph-space rectangle. `rect.zw` is its top-left, so this is
  // a camera-free pixel offset from the label's anchor — world geometry, hence
  // the zoom.
  const quad = vec2f(instance.rect.z, instance.rect.w) + unit;
  const scaled = vec2f(quad.x * scene.pad.x, quad.y * scene.pad.x);

  // 1. The anchor under the camera. The divide happens once per vertex, which
  //    is what keeps the glyph's screen size correct at any depth.
  const anchor = instance.rect.xy;
  const anchorClip = scene.worldToClip * vec4f(anchor.x, anchor.y, 0, 1);
  const w = max(anchorClip.w, 1e-6);
  const anchorNdc = vec2f(anchorClip.x / w, anchorClip.y / w);

  // 2. The glyph quad, added in *screen* space and mapped without the camera.
  const ndc = anchorNdc + vec2f(scaled.x * scene.pixel.x, scaled.y * scene.pixel.y);

  const uv = vec2f(
    instance.uvRect.x + unit.x * instance.uvRect.z,
    instance.uvRect.y + unit.y * instance.uvRect.w,
  );
  // The shadow sample is displaced by the page offset, converted to uv space the
  // same way the built-in shader does (y negated, because clip space is y-up).
  const shadow = vec2f(uv.x - instance.page.x, uv.y + instance.page.y);

  return OblikMsdfVertexOutput({
    position: vec4f(ndc.x, ndc.y, anchorClip.z / w, 1),
    atlasCoordinate: uv,
    shadowCoordinate: shadow,
    uvBounds: instance.uvBounds,
    color: instance.color,
    // The knockout band: the gap colour over the outline width. Both come from
    // the per-frame uniform, so every label shares them and nothing per-label is
    // written when they change.
    outlineColor: scene.gapColor,
    shadowColor: vec4f(0, 0, 0, 0),
    outlineWidth: scene.knockout.x,
    pageIndex: u32(instance.page.w),
  });
});
