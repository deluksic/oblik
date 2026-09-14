/**
 * One glyph instance, with a **world anchor** the camera never rewrites.
 *
 * Glyph's own instance layout carries paragraph-space rectangles, which is
 * exactly why the built-in adapter has to re-project every label on the CPU
 * whenever the camera moves: its shader computes
 * `clip = M · (glyphLocalPixels + position)`, so `position` is an offset inside
 * the *pixel* space and the camera has to live in the same `M` that also scales
 * the glyphs. An affine map cannot hold a translation still while scaling the
 * displacements around it, so no matrix fixes that — the shader has to change.
 *
 * This layout therefore carries the anchor explicitly: the vertex shader
 * projects the anchor `worldToClip` (camera) and adds the glyph's own rectangle
 * through a separate, camera-free `pixel` mapping. A pan is then a single matrix
 * write and touches no instance buffer.
 *
 * The buffers are semantically glyph's portable MSDF lanes (`rect`, `uvRect`,
 * `uvBounds`, `color`, `effectColor`, `page`); `rect.xy` carries the anchor and
 * `rect.zw` the glyph's paragraph-space top-left.
 */
import { f32, mat4x4f, struct, u32, vec2f, vec2u, vec4f } from "typegpu/data";
import type { Infer } from "typegpu/data";

/** Per-instance attributes, one record per glyph quad. */
export const OblikMsdfInstance = struct({
  /** `xy` world anchor; `zw` the glyph's paragraph-space top-left. */
  rect: vec4f,
  /** Atlas rect: origin and span in uv space. */
  uvRect: vec4f,
  /** Clamp bounds for the MSDF texel reads. */
  uvBounds: vec4f,
  /** Straight RGBA fill. */
  color: vec4f,
  /** Packed outline and shadow colours (rgba8 in each lane). */
  effect: vec2u,
  /** `xy` shadow offset, `z` outline width in em, `w` atlas page. */
  page: vec4f,
});

export type OblikMsdfInstance = Infer<typeof OblikMsdfInstance>;

/**
 * Where the camera lives: written once per frame, never per label.
 *
 * `worldToClip` maps a world point to clip space. `pixel` is the *separate*,
 * camera-free mapping a screen pixel takes. Keeping those apart is the entire
 * point of this shader — applying the camera to glyph-local pixels is what made
 * text scale with zoom.
 */
export const OblikScene = struct({
  worldToClip: mat4x4f,
  /** `(2/width, 2/height)`, with y already negated for clip space. */
  pixel: vec2f,
  /** Pane half-size in pixels: the clip-space origin of a world point. */
  half: vec2f,
  /** Unused lanes kept for alignment-friendly edits. */
  pad: vec2f,
  /** `x` = outline width in em; `y` = 1 while a knockout band is wanted. */
  knockout: vec2f,
  /** Outline (gap) colour, straight RGBA. */
  gapColor: vec4f,
});

export type OblikScene = Infer<typeof OblikScene>;

/** Vertex-stage output; also the fragment's input. */
export const OblikMsdfVertexOutput = struct({
  position: vec4f,
  atlasCoordinate: vec2f,
  shadowCoordinate: vec2f,
  uvBounds: vec4f,
  color: vec4f,
  outlineColor: vec4f,
  shadowColor: vec4f,
  outlineWidth: f32,
  pageIndex: u32,
});

export type OblikMsdfVertexOutput = Infer<typeof OblikMsdfVertexOutput>;

/** Uniform lanes the codec compiler is told about, for capacity planning. */
export const OBLIK_UNIFORM_FLOATS = 4 * 4 + 2 + 2 + 2 + 2 + 4;
