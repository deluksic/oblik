import { tgpu } from "typegpu";
import type { TgpuBindGroup, TgpuRoot } from "typegpu";
import { arrayOf, builtin, f32, interpolate, u16, u32, vec2f, vec3f, vec4f } from "typegpu/data";
import { cos, max, sin } from "typegpu/std";

import { MAX_CIRCLE_PIECES } from "../schemas";
import { worldLayout } from "../layout";

/** World → clip, same mapping as pipelines/strokes.ts toClip. */
const toClip = tgpu.fn([vec2f], vec4f)((p) => {
  "use gpu";
  const f = worldLayout.$.frame;
  const k = vec2f(
    f.scale * 2 / max(1, f.pane.x),
    f.scale * 2 / max(1, f.pane.y),
  );
  return vec4f(k * (p - f.cam), 0, 1);
});

const circleVertex = tgpu.vertexFn({
  in: { instanceIndex: builtin.instanceIndex, vertexIndex: builtin.vertexIndex },
  out: { outPos: builtin.position, color: interpolate("flat", vec3f), alpha: interpolate("flat", f32) },
})(({ instanceIndex, vertexIndex }) => {
  "use gpu";
  const inst = worldLayout.$.circles[worldLayout.$.circleOrder[instanceIndex]];
  const piece = vertexIndex / 2;
  if (inst.r1 <= inst.r0 || inst.a1 === inst.a0 || piece > u32(inst.pieces)) {
    return { outPos: vec4f(0, 0, -2, 1), color: vec3f(), alpha: 0 };
  }
  const t = f32(piece) / inst.pieces;
  const ang = inst.a0 + t * (inst.a1 - inst.a0);
  const r = vertexIndex % 2 === 0 ? inst.r0 : inst.r1;
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

/** Shared static triangle-list indices: each fan piece is a quad from the
 * inner/outer ring vertex pair, so indexCount = 6·MAX_CIRCLE_PIECES always and
 * the active piece count lives in the instance. */
export const CIRCLE_INDEX_COUNT = MAX_CIRCLE_PIECES * 6;

export type CirclePipelines = {
  circles: (pass: GPURenderPassEncoder) => {
    drawIndexed(indexCount: number, instanceCount: number): void;
  };
  destroy(): void;
};

export function createCirclePipelines(
  root: TgpuRoot,
  bindGroup: TgpuBindGroup,
  format: GPUTextureFormat,
): CirclePipelines {
  const indices: number[] = [];
  for (let p = 0; p < MAX_CIRCLE_PIECES; p++) {
    const v = p * 2;
    indices.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
  }
  const indexBuffer = root.createBuffer(arrayOf(u16, indices.length), indices).$usage("index");

  const circlePipeline = root
    .createRenderPipeline({
      vertex: circleVertex,
      fragment: circleFragment,
      targets: { format, blend: alphaBlend },
      multisample: { count: 4 },
    })
    .with(bindGroup)
    .withIndexBuffer(indexBuffer);

  return {
    circles: (pass) => circlePipeline.with(pass),
    destroy: () => indexBuffer.destroy(),
  };
}
