import {
  compileCodec,
  id,
  type CodecCapabilitySet,
  type CodecIdFactory,
} from "@pmndrs/glyph/config/codec";
import type { CodecBufferId } from "@pmndrs/glyph/config/codec";
import { createRasterCodecProgram } from "@pmndrs/glyph/config/raster";
/**
 * This renderer's Codec: the portable MSDF technique body plus the engine-owned
 * system lanes it needs.
 *
 * This mirrors `glyph-example-renderer/codec.ts` — the official pattern for a
 * custom renderer, and the canary that the public API is sufficient without
 * reaching into package internals.
 */
import { defineCodecBuffers } from "@pmndrs/glyph/config/schema";
import { msdfCodec } from "@pmndrs/glyph/raster/msdf";

/**
 * Glyph identity that survives a reflow. The engine owns this buffer — it is
 * deliberately absent from the technique's own schema — so it must be declared
 * here with exactly the name and scalar the engine writes.
 */
const STABLE_GLYPH_ID: CodecBufferId = id.buffer("oblik-knockout/stable-glyph-id");

export const oblikSystemBuffers = defineCodecBuffers({
  stableGlyphId: { id: STABLE_GLYPH_ID, scalar: "u32", lanes: ["stableGlyphId"] },
});

/** Stable namespace used to derive this renderer's numeric program identity. */
export const OBLIK_PROGRAM_NAMESPACE = "oblik-knockout";

/** Limits and features this renderer's codec may target. */
export const oblikCapabilitySet: CodecCapabilitySet = Object.freeze({
  capabilities: Object.freeze([
    "storage-buffers",
    "alias-vec2",
    "alias-vec4",
    "ordered-direct",
  ] as const),
  maxBufferBytes: 16 * 1024 * 1024,
  updateAlignment: 4,
  coalesceGapBytes: 128,
  rangeCallPenaltyBytes: 256,
  maxBuffersPerDraw: 8,
  maxResourcesPerDraw: 4,
  maxIndirectDraws: 0,
  fragmentationBudget: 8,
  wholeBufferThresholdBasisPoints: 7_500,
});

/** Assemble the portable MSDF body with this renderer's own system lanes. */
export function oblikCodecDescriptor(ids?: CodecIdFactory) {
  return Object.freeze({
    capabilitySets: [oblikCapabilitySet],
    programs: [
      createRasterCodecProgram(msdfCodec, {
        namespace: OBLIK_PROGRAM_NAMESPACE,
        system: oblikSystemBuffers,
        capabilitySet: oblikCapabilitySet,
        transformMode: "direct",
        allocationMode: "ordered",
        ...(ids === undefined ? {} : { ids }),
      }),
    ],
  });
}

/** The codec body as bytes, for hosts that need to inspect it. */
export function oblikCodecBytes(ids?: CodecIdFactory): Uint8Array {
  return compileCodec(oblikCodecDescriptor(ids));
}
