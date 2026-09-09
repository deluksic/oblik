import { tgpu } from "typegpu";
import type { TgpuBindGroup, TgpuRoot } from "typegpu";
import { arrayOf, builtin, f32, interpolate, u16, vec2f, vec3f, vec4f } from "typegpu/data";
import { max } from "typegpu/std";

import {
  caps,
  endCapSlot,
  lineSegmentIndices,
  LineControlPoint,
  polylineVariableWidth,
  startCapSlot,
} from "../../vendor/typegpu-geometry";
import { worldLayout } from "../layout";
import { MAX_JOIN_COUNT } from "../schemas";

/** World → clip through the Frame uniform; affine, so it commutes with the
 * library's homogeneous w-multiply trick. Matches euclid2/camera.ts worldToScreen:
 * device = pane/2 - (world - cam) * scale (y-up world). NDC normalizes x and y by
 * different half-extents, so the px-per-world scale k is per-axis. WebGPU's NDC
 * y axis points down (framebuffer bottom), so no extra negation here. */
const toClip = tgpu.fn(
  [vec2f, f32],
  vec4f,
)((p, w) => {
  "use gpu";
  const f = worldLayout.$.frame;
  const k = vec2f((f.scale * 2) / max(1, f.pane.x), (f.scale * 2) / max(1, f.pane.y));
  const ndc = vec2f(k.x * (p.x - f.cam.x), k.y * (p.y - f.cam.y));
  return vec4f(ndc * w, 0, w);
});

const strokeVertex = tgpu.vertexFn({
  in: { instanceIndex: builtin.instanceIndex, vertexIndex: builtin.vertexIndex },
  out: {
    outPos: builtin.position,
    color: interpolate("flat", vec3f),
    alpha: interpolate("flat", f32),
  },
})(({ instanceIndex, vertexIndex }) => {
  "use gpu";
  const draw = worldLayout.$.strokes[worldLayout.$.strokeOrder[instanceIndex]];
  if (draw.a.radius < 0 || draw.b.radius < 0 || draw.c.radius < 0 || draw.d.radius < 0) {
    return { outPos: vec4f(), color: vec3f(), alpha: 0 };
  }
  const result = polylineVariableWidth(
    LineControlPoint({ position: draw.a.position, radius: draw.a.radius }),
    LineControlPoint({ position: draw.b.position, radius: draw.b.radius }),
    LineControlPoint({ position: draw.c.position, radius: draw.c.radius }),
    LineControlPoint({ position: draw.d.position, radius: draw.d.radius }),
    vertexIndex,
    MAX_JOIN_COUNT,
  );
  return {
    outPos: toClip(result.vertexPosition, result.w),
    color: draw.run.color,
    alpha: draw.run.alpha,
  };
});

const strokeFragment = tgpu.fragmentFn({
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

export type StrokePipelines = {
  /** World stroke pass: instances index `strokeOrder` into the `strokes` array. */
  strokes: (pass: GPURenderPassEncoder) => {
    drawIndexed(indexCount: number, instanceCount: number): void;
  };
  readonly indexCount: number;
  destroy(): void;
};

export function createStrokePipelines(
  root: TgpuRoot,
  bindGroup: TgpuBindGroup,
  format: GPUTextureFormat,
): StrokePipelines {
  const indices = lineSegmentIndices(MAX_JOIN_COUNT);
  const indexBuffer = root.createBuffer(arrayOf(u16, indices.length), indices).$usage("index");
  const indexCount = indices.length;

  const targets = { format, blend: alphaBlend };

  const strokePipeline = root
    .with(startCapSlot, caps.butt)
    .with(endCapSlot, caps.butt)
    .createRenderPipeline({
      vertex: strokeVertex,
      fragment: strokeFragment,
      targets,
      multisample: { count: 4 },
    })
    .with(bindGroup)
    .withIndexBuffer(indexBuffer);

  return {
    strokes: (pass) => strokePipeline.with(pass),
    indexCount,
    destroy: () => indexBuffer.destroy(),
  };
}
