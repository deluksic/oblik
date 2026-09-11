import { tgpu } from "typegpu";
import type { TgpuBindGroup, TgpuRoot } from "typegpu";
import { builtin, f32, interpolate, u32, vec2f, vec3f, vec4f } from "typegpu/data";
import { dot, max, mix, select, textureSample } from "typegpu/std";

import { imageLayout } from "../layout";

/** Quad corners per reference (triangle-strip). */
export const IMAGE_QUAD_VERTICES = 4;

/** Luma weights of the desaturation a reference is always drawn through. */
const LUMA = vec3f(0.2126, 0.7152, 0.0722);
/** How far toward grey a reference sits before `fade` is applied. */
const DESATURATE = 0.85;

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
 * One reference quad. The record already holds the four world corners in draw
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
    fade: interpolate("flat", f32),
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
  // Vertex order is uv order: (0,0), (1,0), (1,1), (0,1).
  const x = vertexIndex === u32(1) || vertexIndex === u32(2) ? f32(1) : f32(0);
  const y = vertexIndex >= u32(2) ? f32(1) : f32(0);
  return { outPos: toClip(p), uv: vec2f(x, y), fade: inst.fade };
});

/**
 * The reference's colour, prepared for tracing over: first desaturated most of
 * the way to grey (a photograph that keeps its full chroma fights the sketch),
 * then mixed toward the paper by `fade`. Alpha is the bitmap's own, so a
 * transparent PNG still shows the paper through it. The two mixes are the whole
 * look; a theme switch changes `theme.paper` and the reference follows.
 */
export const imageFragment = tgpu.fragmentFn({
  in: { uv: interpolate("linear", vec2f), fade: interpolate("flat", f32) },
  out: vec4f,
})(({ uv, fade }) => {
  "use gpu";
  const sampled = textureSample(imageLayout.$.tex, imageLayout.$.samp, uv);
  const grey = dot(sampled.rgb, LUMA);
  const paper = imageLayout.$.theme.paper;
  return vec4f(mix(mix(sampled.rgb, vec3f(grey), DESATURATE), paper, fade), sampled.a);
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
