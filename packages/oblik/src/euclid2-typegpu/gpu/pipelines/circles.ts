import { tgpu } from "typegpu";
import type { TgpuBindGroup, TgpuRoot } from "typegpu";
import { builtin, f32, interpolate, vec2f, vec3f, vec4f } from "typegpu/data";
import { abs, ceil, clamp, cos, max, sin } from "typegpu/std";

import { worldPerPx } from "../frame";
import { circleLayout } from "../layout";
import { MAX_CIRCLE_PIECES } from "../schemas";

/** World → clip, same mapping as pipelines/strokes.ts toClip. */
const toClip = tgpu.fn(
  [vec2f],
  vec4f,
)((p) => {
  "use gpu";
  const f = circleLayout.$.frame;
  const k = vec2f((f.scale * 2) / max(1, f.pane.x), (f.scale * 2) / max(1, f.pane.y));
  return vec4f(k * (p - f.cam), 0, 1);
});

export const circleVertex = tgpu.vertexFn({
  in: { instanceIndex: builtin.instanceIndex, vertexIndex: builtin.vertexIndex },
  out: {
    outPos: builtin.position,
    color: interpolate("flat", vec3f),
    alpha: interpolate("flat", f32),
  },
})(({ instanceIndex, vertexIndex }) => {
  "use gpu";
  const inst = circleLayout.$.circles[circleLayout.$.circleOrder[instanceIndex]];
  // Math.floor keeps the pair index integral — `vertexIndex / 2` alone compiles
  // as float division and lands outer vertices at half-piece angles, which
  // tapers the band to zero at both sweep ends.
  const piece = Math.floor(vertexIndex / 2);
  // Band width (CSS px → world) and fan budget both follow from the record and
  // the frame, so a zoom reprojects the annulus instead of rewriting it: one
  // piece per ~6 px of arc, the range the CPU used to bake in. `max(radius, 1)`
  // keeps a sub-unit circle smooth without pinning its piece count.
  const sweep = abs(inst.a1 - inst.a0);
  const pieces = clamp(
    ceil((sweep * max(inst.radius, 1) * circleLayout.$.frame.scale) / 6),
    32,
    128,
  );
  if (inst.halfPx <= 0 || sweep === 0 || piece > pieces) {
    return { outPos: vec4f(0, 0, -2, 1), color: vec3f(), alpha: 0 };
  }
  const half = inst.halfPx * worldPerPx(circleLayout.$.frame.scale);
  const t = piece / pieces;
  const ang = inst.a0 + t * (inst.a1 - inst.a0);
  const r = vertexIndex % 2 === 0 ? max(0, inst.radius - half) : inst.radius + half;
  const pos = inst.center + vec2f(cos(ang), sin(ang)) * r;
  return { outPos: toClip(pos), color: inst.color, alpha: inst.alpha };
});

const circleFragment = tgpu.fragmentFn({
  in: { color: interpolate("flat", vec3f), alpha: interpolate("flat", f32) },
  out: vec4f,
})(({ color, alpha }) => {
  "use gpu";
  return vec4f(color, alpha);
});

const alphaBlend: GPUBlendState = {
  color: { operation: "add", srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha" },
  alpha: { operation: "add", srcFactor: "one", dstFactor: "one" },
};

/** Triangle-strip vertex count per instance: pairs of inner/outer ring vertices
 * for every piece boundary plus one closing pair; the active piece count lives
 * in the instance, tail vertices are culled in the vertex shader. */
export const CIRCLE_VERTEX_COUNT = 2 * (MAX_CIRCLE_PIECES + 1);

export type CirclePipelines = {
  circles: (pass: GPURenderPassEncoder) => {
    draw(vertexCount: number, instanceCount: number): void;
  };
};

export function createCirclePipelines(
  root: TgpuRoot,
  bindGroup: TgpuBindGroup,
  format: GPUTextureFormat,
): CirclePipelines {
  const circlePipeline = root
    .createRenderPipeline({
      vertex: circleVertex,
      fragment: circleFragment,
      targets: { format, blend: alphaBlend },
      primitive: { topology: "triangle-strip" },
      multisample: { count: 4 },
    })
    .with(bindGroup);

  return {
    circles: (pass) => circlePipeline.with(pass),
  };
}
