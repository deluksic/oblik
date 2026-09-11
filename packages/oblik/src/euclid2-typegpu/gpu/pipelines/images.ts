import { tgpu } from "typegpu";
import type { TgpuBindGroup, TgpuRoot } from "typegpu";
import { builtin, f32, interpolate, u32, vec2f, vec3f, vec4f } from "typegpu/data";
import { clamp, dot, max, min, mix, saturate, select, textureSample } from "typegpu/std";

import { worldPerPx } from "../frame";
import { imageLayout } from "../layout";
import { edgeCoverage, haloColor } from "./halo";

/** Quad corners per reference (triangle-strip). */
export const IMAGE_QUAD_VERTICES = 4;

/** Luma weights: what "grey" means to the `saturation` dial. */
const LUMA = vec3f(0.2126, 0.7152, 0.0722);
/** Mid-grey: the pivot the `contrast` dial scales about. */
const MID = 0.5;

/** World → clip, the same mapping every other pipeline uses. */
const toClip = tgpu.fn(
  [vec2f],
  vec4f,
)((p) => {
  "use gpu";
  const f = imageLayout.$.frame;
  const k = vec2f((f.scale * 2) / max(1, f.pane.x), (f.scale * 2) / max(1, f.pane.y));
  return vec4f(k * (p - f.cam), 0, 1);
});

/**
 * The reference's selection chrome, in the same two bands a fill's boundary
 * carries — *literally* the same functions (`halo.ts`), so a selected reference
 * and a selected region read identically.
 *
 * The only difference is where the distance comes from. A fill has a boundary
 * walk and gets a signed distance to it; a reference has a quad, so its
 * distance is the uv distance to the nearest border, scaled to CSS px by the
 * rect's own world size and the frame's zoom. That conversion in the shader —
 * not in the record — is what keeps a zoom from rewriting anything, and it is
 * why the band follows a rotated quad for free.
 */
const borderPx = tgpu.fn(
  [vec2f, vec2f, f32],
  f32,
)((uv, size, scale) => {
  "use gpu";
  const inset = min(min(uv.x, 1 - uv.x) * size.x, min(uv.y, 1 - uv.y) * size.y);
  return inset / worldPerPx(scale);
});

/**
 * One reference quad. The record already holds the four world corners in strip
 * order — `rot` and `flip` were folded in on the CPU (`eval/image.ts`) — so the
 * vertex shader picks a corner and hands the fragment its texture coordinate.
 * Nothing here depends on the camera beyond the frame uniform, so a pan or zoom
 * writes no records.
 */
export const imageVertex = tgpu.vertexFn({
  in: { instanceIndex: builtin.instanceIndex, vertexIndex: builtin.vertexIndex },
  out: {
    outPos: builtin.position,
    uv: interpolate("linear", vec2f),
    // A varying cannot be a struct, so the dials travel flat — by name.
    opacity: interpolate("flat", f32),
    saturation: interpolate("flat", f32),
    contrast: interpolate("flat", f32),
    edge: interpolate("flat", vec4f),
    edgeWidthPx: interpolate("flat", f32),
    size: interpolate("flat", vec2f),
    haloRing: interpolate("flat", vec4f),
    haloKnock: interpolate("flat", vec4f),
    haloHalfPx: interpolate("flat", vec2f),
  },
})(({ instanceIndex, vertexIndex }) => {
  "use gpu";
  const inst = imageLayout.$.images[instanceIndex];
  // `select`, not a ternary: the branches are whole vec2f records read through
  // the storage pointer, which TGSL will not put in a conditional expression.
  const p = select(
    select(inst.a, inst.b, vertexIndex === u32(1)),
    select(inst.c, inst.d, vertexIndex === u32(3)),
    vertexIndex >= u32(2),
  );
  // Vertex order is strip order (see `imageQuad`), and the uv table is the
  // corners' *screen* roles (`IMAGE_QUAD_UVS` in `eval/image.ts`): vertices 0
  // and 1 are the rect's bottom edge, 2 and 3 its top, so the texture's bottom
  // row is v = 1. Reading world y as if it ran down puts the picture upside
  // down without failing anything, so `wgsl.test.ts` pins both selects.
  const x = vertexIndex === u32(1) || vertexIndex === u32(3) ? f32(1) : f32(0);
  const y = vertexIndex >= u32(2) ? f32(0) : f32(1);
  return {
    outPos: toClip(p),
    uv: vec2f(x, y),
    opacity: inst.style.opacity,
    saturation: inst.style.saturation,
    contrast: inst.style.contrast,
    edge: inst.edge,
    edgeWidthPx: inst.edgeWidthPx,
    size: inst.size,
    haloRing: inst.haloRing,
    haloKnock: inst.haloKnock,
    haloHalfPx: inst.haloHalfPx,
  };
});

/**
 * The reference's colour, prepared for tracing over. Three dials, in the order
 * they compose: `saturation` mixes between the bitmap's grey and the bitmap
 * (a photograph that keeps its full chroma fights the sketch), `contrast` scales
 * about mid-grey (hardening line work), and `opacity` scales the bitmap's own
 * alpha — so a faint reference is mixed toward the paper *by the blend*, not in
 * here, which is why this shader has no paper colour and a theme switch needs
 * nothing from it. A transparent PNG still shows the paper through it, twice
 * over.
 */
export const imageFragment = tgpu.fragmentFn({
  in: {
    uv: interpolate("linear", vec2f),
    opacity: interpolate("flat", f32),
    saturation: interpolate("flat", f32),
    contrast: interpolate("flat", f32),
    edge: interpolate("flat", vec4f),
    edgeWidthPx: interpolate("flat", f32),
    size: interpolate("flat", vec2f),
    haloRing: interpolate("flat", vec4f),
    haloKnock: interpolate("flat", vec4f),
    haloHalfPx: interpolate("flat", vec2f),
  },
  out: vec4f,
})(({
  uv,
  opacity,
  saturation,
  contrast,
  edge,
  edgeWidthPx,
  size,
  haloRing,
  haloKnock,
  haloHalfPx,
}) => {
  "use gpu";
  const sampled = textureSample(imageLayout.$.tex, imageLayout.$.samp, uv);
  const grey = mix(vec3f(dot(sampled.rgb, LUMA)), sampled.rgb, saturation);
  const base = saturate((grey - MID) * contrast + MID);
  const fa = sampled.a * opacity;

  // Same convention as a fill's boundary: the distance is signed, negative
  // inside, here measured in CSS px from the quad's border inward.
  const d = -borderPx(uv, size, imageLayout.$.frame.scale);
  const band = haloColor(d, haloRing, haloKnock, haloHalfPx);
  // The node's own outline sits above the halo, as it does on a fill. Only its
  // inner half can land — the outer half is outside the quad — so the band runs
  // `edgeWidthPx / 2` in from the border.
  const t = clamp(edgeCoverage(d, edgeWidthPx) / max(band.w, 1e-6), 0, 1) * edge.w;
  const chrome = vec4f(mix(band.xyz, edge.xyz, t), band.w);

  // Both over the bitmap with straight alpha, the formulation `haloWithEdge`
  // uses: a cold reference has a zero-coverage chrome and comes out exactly as
  // the two mixes it always was.
  const alpha = chrome.w + fa * (1 - chrome.w);
  return vec4f((chrome.xyz * chrome.w + base * (fa * (1 - chrome.w))) / max(alpha, 1e-6), alpha);
});

const alphaBlend: GPUBlendState = {
  color: { operation: "add", srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha" },
  alpha: { operation: "add", srcFactor: "one", dstFactor: "one" },
};

export type ImagePipelines = {
  /** Draw one reference from slot `firstInstance` of the shared instance array. */
  image: (pass: GPURenderPassEncoder) => {
    draw(
      vertexCount: number,
      instanceCount: number,
      firstVertex?: number,
      firstInstance?: number,
    ): void;
  };
  destroy(): void;
};

/** One pipeline per bound texture: the bind group is a creation-time constant
 * here, exactly like the grid's colour, and a source is a small, bounded set. */
export function createImagePipelines(
  root: TgpuRoot,
  bindGroup: TgpuBindGroup,
  format: GPUTextureFormat,
): ImagePipelines {
  const pipeline = root
    .createRenderPipeline({
      vertex: imageVertex,
      fragment: imageFragment,
      targets: { format, blend: alphaBlend },
      primitive: { topology: "triangle-strip" },
      multisample: { count: 4 },
    })
    .with(bindGroup);

  return {
    image: (pass) => pipeline.with(pass),
    destroy: () => {},
  };
}
