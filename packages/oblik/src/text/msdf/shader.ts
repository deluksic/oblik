/**
 * The vertex stage: **the camera is applied to the anchor, and to nothing else.**
 *
 * Glyph's own vertex stage is `clip = M · (glyphLocalPixels + position)`, which
 * puts the camera and the glyph's own pixels in one matrix. An affine map cannot
 * translate a point while scaling the displacements around it, so that shader
 * forces `position` to be the label's *screen* position: a pan re-projects every
 * label on the CPU. This stage splits the two terms,
 *
 *     clip.xy = worldToClip · anchor  +  view · (glyphLocalPixels + offset)
 *
 * so the camera touches only the anchor. A pan or a zoom writes one matrix and
 * no instance buffer; a label that moves writes its own twelve floats.
 *
 * The glyph term is deliberately camera-free: text stays screen-sized instead of
 * growing with the zoom, which is what the HTML overlay does and therefore what
 * the two paths have to agree on.
 *
 * The quad is **dilated by the ring gap**. Glyph's MSDF atlas stores a signed
 * distance, so the glyph and a band around it come out of the same sample; the
 * band simply has no geometry to land on unless the quad is grown by the band's
 * width. `uv` is extended by the same pixel-to-uv scale, so the field keeps its
 * size and the band reads the padding the baker left around the glyph's cell
 * rather than stretching the glyph across the wider quad.
 */
import { tgpu } from "typegpu";
import { builtin, f32, interpolate, u32, vec2f, vec4f } from "typegpu/data";
import { max, select } from "typegpu/std";

import { oblikLayout } from "./instance";

/**
 * Unit-quad corner from a vertex index: 0,1 top-left/right; 2,3 bottom-left/
 * right; 4,5 the repeated pair that makes two triangles. No geometry buffer.
 */
const corner = tgpu.fn(
  [u32],
  vec2f,
)((index) => {
  "use gpu";
  const x = index === 1 || index === 4 || index === 5;
  const y = index === 2 || index === 3 || index === 5;
  return vec2f(select(0, 1, x), select(0, 1, y));
});

export const oblikVertex = tgpu.vertexFn({
  in: {
    index: builtin.vertexIndex,
    // Paragraph-space ink box of the glyph, in px, y down. The Codec writes it.
    rect: vec4f,
    uvRect: vec4f,
    uvBounds: vec4f,
    color: vec4f,
    // `xy` the shadow offset, `z` the outline width, `w` the atlas page. Only
    // the page is read: the band is ours and there is no shadow.
    page: vec4f,
  },
  out: {
    position: builtin.position,
    /**
     * This fragment's position in the glyph's own **paragraph pixels** (y down),
     * already widened. The fragment clamps it back to the ink box to find the
     * nearest texel the atlas actually stores, and measures how far outside that
     * is — which is what extends the field past the box.
     */
    localPx: vec2f,
    /** The ink box: `xy` its top-left in px, `zw` its size. */
    box: vec4f,
    uvRect: vec4f,
    uvBounds: vec4f,
    color: vec4f,
    ringColor: vec4f,
    gap: f32,
    page: interpolate("flat", u32),
  },
})((input) => {
  "use gpu";
  const unit = corner(u32(input.index));

  // The band is wanted only when the label asked for one; a disabled ring has
  // zero width, which also collapses the dilation below to the glyph itself.
  const gap = max(oblikLayout.$.ring.x * oblikLayout.$.ring.y, 0);

  // The glyph's own box, and the same box grown by the band on every side.
  const minPx = vec2f(input.rect.x, input.rect.y);
  const sizePx = vec2f(input.rect.z, input.rect.w);
  const grownPx = vec2f(sizePx.x + gap * 2, sizePx.y + gap * 2);
  const px = vec2f(minPx.x - gap, minPx.y - gap) + unit * grownPx;

  // 1. The anchor under the camera. This is the only place the camera appears.
  const anchor = oblikLayout.$.label.xy;
  const anchorClip = oblikLayout.$.camera * vec4f(anchor.x, anchor.y, 0, 1);
  const w = max(anchorClip.w, 1e-6);
  const anchorNdc = vec2f(anchorClip.x / w, anchorClip.y / w);

  // 2. The glyph's own pixels, added in screen space through the camera-free
  //    mapping. `offset` is the label box's own dx/dy, also in px.
  const screenPx = px + oblikLayout.$.label.zw;
  const ndc = anchorNdc + vec2f(screenPx.x * oblikLayout.$.view.x, -screenPx.y * oblikLayout.$.view.y);

  return {
    position: vec4f(ndc.x, ndc.y, anchorClip.z / w, 1),
    localPx: px,
    box: vec4f(minPx.x, minPx.y, sizePx.x, sizePx.y),
    uvRect: input.uvRect,
    uvBounds: input.uvBounds,
    color: input.color,
    ringColor: oblikLayout.$.ringColor,
    gap,
    page: u32(input.page.w),
  };
});
