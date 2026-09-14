/**
 * The label font's MSDF bake settings, and the format request that matches them.
 *
 * These two have to agree, and glyph will not tell you when they don't. A
 * raster's identity is derived from the format's **descriptor**, which is where
 * the bake options live; the loader looks the baked artifact up by that key. Ask
 * for a descriptor the asset was not baked with and the lookup simply finds
 * nothing, so glyph falls back to generating the raster at runtime — which fails
 * with `msdf runtime generation requires retained source bytes`, a message that
 * says nothing about the mismatch. Hence one constant, used by both the request
 * here and the assertion in `bake.test.ts`.
 *
 * `pixel-range` is not a quality knob so much as the knockout's budget. Glyph
 * packs each glyph's cell as the ink box plus `pixel-range / 2` texels of
 * distance margin per side, and the field is only valid over that margin. At
 * `em-size=48` a 12px label gets `(40 / 2) · 12 / 48 = 5px` of margin.
 *
 * Changing these means re-running `pnpm bake:fonts`, whose flags must match.
 */
import { msdf } from "@pmndrs/glyph/raster/msdf";

export const OBLIK_MSDF_OPTIONS = Object.freeze({ emSize: 48, pixelRange: 40 } as const);

/** The font-face format to load with, carrying exactly `OBLIK_MSDF_OPTIONS`. */
export const OBLIK_MSDF_FORMAT = msdf(OBLIK_MSDF_OPTIONS);
