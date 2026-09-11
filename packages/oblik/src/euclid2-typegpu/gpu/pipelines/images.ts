import { tgpu } from "typegpu";
import type { TgpuBindGroup, TgpuRoot } from "typegpu";
import { builtin, f32, interpolate, u32, vec2f, vec3f, vec4f } from "typegpu/data";
import { clamp, dot, max, min, mix, saturate, select, textureSample } from "typegpu/std";

import { worldPerPx } from "../frame";
import { imageLayout } from "../layout";

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
 * The selection outline's coverage: a band `edgePx` CSS px wide measured inward
 * from the quad's border, antialiased at its inner edge.
 *
 * `size` is the pre-rotation rect's world size, which is what turns the uv
 * distance to a border into a world distance — so the band follows a rotated
 * quad and stays `edgePx` wide on screen at any zoom, because the px→world
 * conversion reads the frame rather than the record.
 */
const edgeCoverage = tgpu.fn(
  [vec2f, vec2f, f32, f32],
  f32,
)((uv, size, edgePx, scale) => {
  "use gpu";
  const band = edgePx * worldPerPx(scale);
  // Distance to the nearest border measured in bands: <= 1 is inside it.
  const t = min(min(uv.x, 1 - uv.x) * (size.x / band), min(uv.y, 1 - uv.y) * (size.y / band));
  return clamp((1 - t) * edgePx + 0.5, 0, 1);
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
    style: interpolate("flat", vec3f),
    edge: interpolate("flat", vec4f),
    edgePx: interpolate("flat", f32),
    size: interpolate("flat", vec2f),
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
    style: vec3f(inst.opacity, inst.saturation, inst.contrast),
    edge: inst.edge,
    edgePx: inst.edgePx,
    size: inst.size,
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
    style: interpolate("flat", vec3f),
    edge: interpolate("flat", vec4f),
    edgePx: interpolate("flat", f32),
    size: interpolate("flat", vec2f),
  },
  out: vec4f,
})(({ uv, style, edge, edgePx, size }) => {
  "use gpu";
  const sampled = textureSample(imageLayout.$.tex, imageLayout.$.samp, uv);
  const grey = mix(vec3f(dot(sampled.rgb, LUMA)), sampled.rgb, style.y);
  const base = saturate((grey - MID) * style.z + MID);
  const fa = sampled.a * style.x;
  // The outline goes *over* the bitmap with straight alpha — the same
  // formulation the fill's own outline uses — and a zero edge alpha (a cold
  // reference) leaves the fragment exactly as it was.
  const ea = edgeCoverage(uv, size, edgePx, imageLayout.$.frame.scale) * edge.w;
  const alpha = ea + fa * (1 - ea);
  return vec4f((edge.xyz * ea + base * (fa * (1 - ea))) / max(alpha, 1e-6), alpha);
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
