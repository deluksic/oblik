/**
 * The bind group every glyph quad draws through, and the split it encodes.
 *
 * Glyph's built-in TypeGPU pipeline puts the camera and the glyph's own pixels
 * in **one** matrix: its vertex stage computes `clip = M · (glyphLocalPixels +
 * position)`. An affine map cannot translate a point while scaling the
 * displacements around it, so with that shader a label cannot hold a world
 * anchor — `position` has to be the label's screen position, and every label is
 * re-projected on the CPU whenever the camera moves.
 *
 * This layout splits the two terms:
 *
 *     clip.xy = worldToClip · anchor  +  view · (glyphLocalPixels + offset)
 *
 * - `camera` is written per frame. A pan or a zoom is this one write.
 * - `label` is **per text**: `xy` the world anchor, `zw` a screen-space offset
 *   in CSS px (y down) from the anchor to the text's box. It is written only
 *   when that label actually moves.
 * - `view` is `(2/width, 2/height)`: one screen pixel in clip space, with no
 *   camera in it, which is what keeps text screen-sized instead of growing with
 *   the zoom.
 * - `ring` and `ringColor` carry the knockout band, per text, so the band costs
 *   a shader branch rather than sixteen extra texts.
 *
 * The instance attributes are glyph's portable MSDF lanes, unchanged: `rect`
 * and `uvRect` come from the Codec exactly as the built-in renderer reads them,
 * so the atlas, the layout and the shaping stay glyph's.
 */
import { tgpu } from "typegpu";
import { f32, mat4x4f, texture2dArray, vec4f } from "typegpu/data";

export const oblikLayout = tgpu.bindGroupLayout({
  /** `worldToClip` for the pane or the scene. The only thing a camera move writes. */
  camera: { uniform: mat4x4f },
  /** `(2/width, 2/height)` — one screen pixel in clip space, camera-free. */
  view: { uniform: vec4f },
  /**
   * `xy` the atlas extent in texels, `z` the baked `pixelRange`, `w` unused.
   *
   * The field is scaled so the full `[0, 1]` of a texel spans `pixelRange`
   * plane units — half of it either side of the outline, which is
   * `MSDF_MAX_OUTLINE_ATLAS_PIXELS`. One plane unit is one atlas texel at this
   * bake (`emSize` == `planeUnitsPerEm`), so this uniform is what turns a texel
   * value into a distance in glyph pixels.
   */
  atlasInfo: { uniform: vec4f },
  /** Per text: `xy` world anchor, `zw` screen offset in CSS px (y down). */
  label: { uniform: vec4f },
  /** Per text: `x` knockout gap in px, `y` 1 while a ring is wanted. */
  ring: { uniform: vec4f },
  /** Per text: the knockout colour, straight RGBA. */
  ringColor: { uniform: vec4f },
  atlas: { texture: texture2dArray(f32) },
  samp: { sampler: "filtering" },
});

/**
 * The knockout band a label asks for: thickness in CSS px, and its colour.
 */
export type OblikRingInput = {
  readonly gap: number;
  readonly enabled: boolean;
  readonly color: readonly [number, number, number];
};
