/**
 * The fragment stages: **two of them, and the order they are recorded in is the
 * whole point.**
 *
 * A label's knockout ring is the background showing through around the glyph. It
 * cannot be composited inside the glyph's own quad, because glyphs overlap: with
 * kerning, `AV` puts the next glyph's box over the previous glyph's ink, and a
 * ring drawn in the same quad as its fill paints paper over the neighbour's
 * stroke. The result looks like the later glyphs are cutting holes in the
 * earlier ones.
 *
 * So the ring and the ink are separated into two stages, and every ring in the
 * layer is recorded **before** any ink:
 *
 * 1. {@link oblikBandFragment} — the knockout band, in the ring colour.
 * 2. {@link oblikFillFragment} — the glyph itself, on top of every band.
 *
 * That is a separate pass in effect, without a second attachment: draw order
 * inside one pass is what decides, and blending the opaque ring colour is what
 * "clear the area" means here. The two stages share one vertex stage, one bind
 * group and one instance buffer; they differ only in which of the two coverages
 * they keep.
 *
 * ## Why everything is done in the glyph's own pixels
 *
 * That is the only space where the two quantities involved have their natural
 * size: "one screen pixel" is 1, and the knockout gap is already a number of
 * pixels. An earlier version worked in normalised distance units and recovered
 * the pixel scale with `fwidth` of the reconstructed field — which is wrong for
 * an MSDF, whose median-of-three value is only *approximately* a distance and
 * does not have unit gradient. That is why the edges had no antialiasing.
 *
 * ## Why the band is extrapolated as well as sampled
 *
 * Glyph packs each glyph's cell as the ink box plus `pixel-range / 2` texels of
 * distance margin, so a band within that margin reads real texels. Beyond it the
 * field is extended rather than smeared: for any texel `t`, the distance at `q`
 * is at least `s(t) − |q − t|`, and subtracting the straight-line distance to
 * the nearest stored texel is that bound. `pnpm bake:fonts` sets `pixel-range`
 * to leave more margin than `LABEL_GAP_PX`.
 */
import { tgpu } from "typegpu";
import { f32, interpolate, u32, vec2f, vec3f, vec4f } from "typegpu/data";
import { clamp, length, max, min, textureSample } from "typegpu/std";

import { oblikLayout } from "./instance";

/** Median of the three channels: the MSDF's distance, positive inside. */
const median3 = tgpu.fn(
  [vec3f],
  f32,
)((v) => {
  "use gpu";
  return max(min(v.r, v.g), min(max(v.r, v.g), v.b));
});

/**
 * A texel value as a signed distance in glyph pixels, extended out of the cell.
 *
 * `(value - 0.5)` is the normalised field, `rangePx` is how many glyph pixels
 * the field's full range spans, and `outside` is the straight-line distance to
 * the nearest stored texel — the term that carries the field past the box.
 * TGSL has no closures, so this is a module-level `tgpu.fn` rather than an
 * inline arrow.
 */
const asDistancePx = tgpu.fn(
  [f32, f32, f32],
  f32,
)((value, rangePx, outside) => {
  "use gpu";
  return (value - 0.5) * rangePx - outside;
});

/** The varyings both stages read; they are the vertex stage's whole output. */
const varyings = {
  localPx: vec2f,
  box: vec4f,
  uvRect: vec4f,
  uvBounds: vec4f,
  color: vec4f,
  ringColor: vec4f,
  gap: f32,
  page: interpolate("flat", u32),
} as const;

/**
 * One field sample, both coverages: `x` the glyph, `y` the knockout band around
 * it. Both stages call this, and each keeps one component — the sample is
 * shared by construction, so the band can never disagree with the ink about
 * where the glyph is.
 */
const oblikCoverage = tgpu.fn(
  [vec2f, vec4f, vec4f, vec4f, u32, f32],
  vec2f,
)((localPx, box, uvRect, uvBounds, page, gap) => {
  "use gpu";
  const minPx = box.xy;
  const sizePx = box.zw;

  // The nearest point of the glyph's cell. The box is the ink plus the bake's
  // margin, so everything the atlas stores is at or inside this point, and the
  // distance from the fragment to it is what the field has to be extended by.
  const cell = clamp(localPx, minPx, minPx + sizePx);
  const outside = length(localPx - cell);

  const uvPerPx = uvRect.zw / max(sizePx, vec2f(1e-6, 1e-6));
  const uv = clamp(uvRect.xy + (cell - minPx) * uvPerPx, uvBounds.xy, uvBounds.zw);
  const sample = textureSample(oblikLayout.$.atlas, oblikLayout.$.samp, uv, page);

  // A texel value is a distance: the full [0, 1] spans `pixelRange` plane
  // units, one plane unit is one atlas texel at this bake, and the glyph's own
  // pixels are `atlasWidth · uvSpan / sizePx` texels each.
  const pxPerUnit = max(sizePx.x, 1e-6) / max(oblikLayout.$.atlasInfo.x * uvRect.z, 1e-6);
  const rangePx = oblikLayout.$.atlasInfo.z * pxPerUnit;

  // The fill keeps the median field, which holds a corner where the true
  // distance rounds it; the band uses the alpha channel, which is the real
  // distance and therefore the one worth extrapolating.
  const fill = clamp(asDistancePx(median3(sample.rgb), rangePx, outside) + 0.5, 0, 1);
  const grown = clamp(asDistancePx(sample.a, rangePx, outside) + gap + 0.5, 0, 1);
  return vec2f(fill, max(grown - fill, 0));
});

/** Stage 1 of 2: the knockout band. Recorded before every fill in the layer. */
export const oblikBandFragment = tgpu.fragmentFn({ in: varyings, out: vec4f })((input) => {
  "use gpu";
  const coverage = oblikCoverage(
    input.localPx,
    input.box,
    input.uvRect,
    input.uvBounds,
    u32(input.page),
    input.gap,
  );
  return vec4f(input.ringColor.rgb, input.ringColor.a * coverage.y);
});

/** Stage 2 of 2: the glyph itself, over every band already in the pass. */
export const oblikFillFragment = tgpu.fragmentFn({ in: varyings, out: vec4f })((input) => {
  "use gpu";
  const coverage = oblikCoverage(
    input.localPx,
    input.box,
    input.uvRect,
    input.uvBounds,
    u32(input.page),
    0,
  );
  return vec4f(input.color.rgb, input.color.a * coverage.x);
});
