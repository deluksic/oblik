import { readFileSync } from "node:fs";

import { msdfRasterKey } from "@pmndrs/glyph/raster/msdf";
import { describe, expect, test } from "vitest";

import { OBLIK_MSDF_OPTIONS } from "./bake";

/**
 * The baked font and the format the app requests must agree, and nothing at
 * runtime says so.
 *
 * Glyph derives a raster's identity from the format's descriptor — the bake
 * options — and looks the artifact up by that key. A mismatch does not fail
 * loudly: the lookup misses, glyph falls back to generating the raster at
 * runtime, and the app dies with `msdf runtime generation requires retained
 * source bytes`, which names neither the bake nor the request. That is exactly
 * how a re-bake with new options broke the labels once. This reads the real
 * artifact and compares keys, so the next mismatch fails here instead.
 */

/** `packages/oblik/src/text/msdf` → the repo root. */
const FONT_ASSET = new URL("../../../../../apps/demo/public/fonts/noto-sans.font.glb", import.meta.url);

/** The `rasterKey` the GLB's `PMNDRS_font.rasters[0]` declares. */
function bakedRasterKey(glb: Uint8Array): string {
  const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  expect(view.getUint32(0, true)).toBe(0x46546c67);
  let offset = 12;
  let json: string | undefined;
  while (offset < glb.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    if (type === 0x4e4f534a) {
      json = new TextDecoder().decode(glb.subarray(offset + 8, offset + 8 + length));
      break;
    }
    offset += 8 + length;
  }
  if (json === undefined) throw new Error("baked font has no JSON chunk");
  const document = JSON.parse(json) as {
    extensions: {
      PMNDRS_font: { rasters: readonly { kind: string; rasterKey: string }[] };
      PMNDRS_font_distance_field: { emSize: number; pixelRange: number };
    };
  };
  expect(document.extensions.PMNDRS_font_distance_field.emSize).toBe(OBLIK_MSDF_OPTIONS.emSize);
  expect(document.extensions.PMNDRS_font_distance_field.pixelRange).toBe(OBLIK_MSDF_OPTIONS.pixelRange);
  const msdf = document.extensions.PMNDRS_font.rasters.find((raster) => raster.kind === "msdf");
  if (msdf === undefined) throw new Error("baked font carries no msdf raster");
  return msdf.rasterKey;
}

describe("label font bake", () => {
  test("the baked raster is the one the app asks for", () => {
    const glb = readFileSync(FONT_ASSET);
    expect(bakedRasterKey(glb)).toBe(msdfRasterKey(OBLIK_MSDF_OPTIONS));
  });

  test("the default options would not resolve — the options are load-bearing", () => {
    // Guards the test above from passing for the wrong reason: if these ever
    // coincide, the bake has drifted back to the defaults and the knockout has
    // lost its margin.
    expect(msdfRasterKey()).not.toBe(msdfRasterKey(OBLIK_MSDF_OPTIONS));
  });

  test("the bake leaves room for the knockout ring", () => {
    // The cell is the ink box plus `pixelRange / 2` texels per side. At the
    // label font size that has to exceed the ring's width in px, or the band's
    // outer edge lands on clamped texels and stops being antialiased.
    const glyphPxPerTexel = OBLIK_MSDF_OPTIONS.emSize / 12;
    const marginPx = OBLIK_MSDF_OPTIONS.pixelRange / 2 / glyphPxPerTexel;
    expect(marginPx).toBeGreaterThan(4);
  });
});
