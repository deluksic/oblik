import { tgpu } from "typegpu";
import type { TgpuBindGroup, TgpuRoot } from "typegpu";
import { arrayOf, builtin, f32, interpolate, u16, vec2f, vec3f, vec4f } from "typegpu/data";
import { max } from "typegpu/std";

import {
  caps,
  endCapSlot,
  lineSegmentIndices,
  polylineVariableWidth,
  startCapSlot,
} from "../../vendor/typegpu-geometry";
import { Frame, MAX_JOIN_COUNT, MAX_GRID_DRAWS, MAX_STROKE_DRAWS, StrokeDraw } from "../schemas";

export const worldLayout = tgpu.bindGroupLayout({
  frame: { uniform: Frame },
  strokes: { storage: arrayOf(StrokeDraw, MAX_STROKE_DRAWS) },
  grid: { storage: arrayOf(StrokeDraw, MAX_GRID_DRAWS) },
});

/** World (y-up) → clip (y-down) through the Frame uniform; affine, so it commutes
 * with the library's homogeneous w-multiply trick. NDC normalizes x and y by
 * different half-extents, so the px-per-world scale k is per-axis. */
const toClip = tgpu.fn([vec2f, f32], vec4f)((p, w) => {
  "use gpu";
  const f = worldLayout.$.frame;
  const k = vec2f(
    f.scale * 2 / max(1, f.pane.x),
    f.scale * 2 / max(1, f.pane.y),
  );
  const ndc = vec2f(k.x * (p.x - f.cam.x), -(k.y * (p.y - f.cam.y)));
  return vec4f(ndc * w, 0, w);
});

const gridVertex = tgpu.vertexFn({
  in: { instanceIndex: builtin.instanceIndex, vertexIndex: builtin.vertexIndex },
  out: { outPos: builtin.position, color: interpolate("flat", vec3f) },
})(({ instanceIndex, vertexIndex }) => {
  "use gpu";
  const draw = worldLayout.$.grid[instanceIndex];
  if (draw.a.radius < 0 || draw.b.radius < 0 || draw.c.radius < 0 || draw.d.radius < 0) {
    return { outPos: vec4f(), color: vec3f() };
  }
  const result = polylineVariableWidth(draw.a, draw.b, draw.c, draw.d, vertexIndex, MAX_JOIN_COUNT);
  return { outPos: toClip(result.vertexPosition, result.w), color: draw.run.color };
});

const strokeVertex = tgpu.vertexFn({
  in: { instanceIndex: builtin.instanceIndex, vertexIndex: builtin.vertexIndex },
  out: { outPos: builtin.position, color: interpolate("flat", vec3f) },
})(({ instanceIndex, vertexIndex }) => {
  "use gpu";
  const draw = worldLayout.$.strokes[instanceIndex];
  if (draw.a.radius < 0 || draw.b.radius < 0 || draw.c.radius < 0 || draw.d.radius < 0) {
    return { outPos: vec4f(), color: vec3f() };
  }
  const result = polylineVariableWidth(draw.a, draw.b, draw.c, draw.d, vertexIndex, MAX_JOIN_COUNT);
  return { outPos: toClip(result.vertexPosition, result.w), color: draw.run.color };
});

const strokeFragment = tgpu.fragmentFn({
  in: { color: interpolate("flat", vec3f) },
  out: vec4f,
})(({ color }) => {
  "use gpu";
  return vec4f(color, 1);
});

const alphaBlend: GPUBlendState = {
  color: { operation: "add", srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha" },
  alpha: { operation: "add", srcFactor: "one", dstFactor: "one" },
};

export type StrokePipelines = {
  /** Hairline grid pass: instances indexed into the `grid` storage array. */
  grid: (pass: GPURenderPassEncoder) => { drawIndexed(indexCount: number, instanceCount: number): void };
  /** World stroke pass: instances indexed into the `strokes` storage array. */
  strokes: (pass: GPURenderPassEncoder) => { drawIndexed(indexCount: number, instanceCount: number): void };
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

  const gridPipeline = root
    .with(startCapSlot, caps.butt)
    .with(endCapSlot, caps.butt)
    .createRenderPipeline({
      vertex: gridVertex,
      fragment: strokeFragment,
      targets,
      multisample: { count: 4 },
    })
    .with(bindGroup)
    .withIndexBuffer(indexBuffer);

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
    grid: (pass) => gridPipeline.with(pass),
    strokes: (pass) => strokePipeline.with(pass),
    indexCount,
    destroy: () => indexBuffer.destroy(),
  };
}
