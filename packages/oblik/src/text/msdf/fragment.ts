import {
  MsdfCompositeInput,
  MsdfCoverageInput,
  msdfComposite,
  msdfCoverage,
} from "@pmndrs/glyph/shaders/typegpu/msdf";
/**
 * The fragment stage: **one quad, one distance field, gap included.**
 *
 * There is no stamping here and there never should have been. Glyph's MSDF atlas
 * stores a signed distance per texel, so the glyph and any ring around it come
 * out of the same sample. `msdfCoverage` already returns the three the technique
 * needs — fill, an outline band at `distance − outlineWidth`, and shadow:
 *
 *     coverage = msdfCoverage({ atlasCoordinate, shadowCoordinate, uvBounds,
 *                               atlasSize, pixelRange, baseSample, shadowSample,
 *                               outlineWidth })
 *     //  .x fill    .y band (outline)    .z shadow
 *
 * and `msdfComposite` mixes them in the order that produces a knockout:
 * shadow, then the band over it, then the glyph. So the whole effect is:
 *
 *     outlineColor = the background      // the band erases the shadow
 *     outlineWidth = the gap, in em
 *
 * That is what those two lanes were always for. The adapter never filled them —
 * it derives the width from the span extent — so an outline clipped at the
 * glyph's quad and the ring had to be faked. Here the width is ours, and the
 * vertex stage grows the quad by the same amount so the band has geometry to
 * land on. One quad, one texture read, one pass.
 */
import { tgpu } from "typegpu";
import { f32, texture2dArray, u32, vec4f } from "typegpu/data";
import { textureSample } from "typegpu/std";

import { OblikMsdfVertexOutput, OblikScene } from "./instance";

/** The MSDF atlas plus the uniform lane that carries the band's appearance. */
export const oblikFragmentLayout = tgpu.bindGroupLayout({
  atlas: { texture: texture2dArray(f32) },
  samp: { sampler: "filtering" },
  scene: { uniform: OblikScene },
});

/**
 * One glyph fragment: reconstruct the field, then colour it.
 *
 * `atlasSize` and `pixelRange` come from the baked artifact — the pixel range is
 * how many texels one distance unit spans, which is what turns the field into an
 * exactly-one-pixel-wide antialiased edge at any zoom.
 */
export const oblikFragment = tgpu.fn(
  [OblikMsdfVertexOutput, vec4f, OblikScene, f32],
  vec4f,
)((input, _fragmentPosition, scene, pixelRange) => {
  "use gpu";
  const atlasSize = scene.pad; // `xy` of pad carries the atlas extent in texels

  // The two atlas reads: the glyph, and the same glyph displaced for whatever
  // shadow the instance asks for.
  const baseSample = textureSample(
    oblikFragmentLayout.$.atlas,
    oblikFragmentLayout.$.samp,
    input.atlasCoordinate,
    u32(input.pageIndex),
  );
  const shadowSample = textureSample(
    oblikFragmentLayout.$.atlas,
    oblikFragmentLayout.$.samp,
    input.shadowCoordinate,
    u32(input.pageIndex),
  );

  const cov = msdfCoverage(
    MsdfCoverageInput({
      atlasCoordinate: input.atlasCoordinate,
      shadowCoordinate: input.shadowCoordinate,
      uvBounds: input.uvBounds,
      atlasSize,
      pixelRange,
      baseSample,
      shadowSample,
      outlineWidth: input.outlineWidth,
    }),
  );

  return msdfComposite(
    MsdfCompositeInput({
      coverage: cov,
      fillColor: input.color,
      // The knockout: the band is painted in the background colour, so it erases
      // whatever the glyph sits on across the gap width.
      outlineColor: scene.gapColor,
      shadowColor: input.shadowColor,
    }),
  );
});
