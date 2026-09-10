import {
  caps,
  endCapSlot,
  lineSegmentIndices,
  LineControlPoint,
  lineVariableWidth,
  polylineVariableWidth,
  startCapSlot,
} from "@typegpu/geometry";
import { tgpu } from "typegpu";
import type { TgpuBindGroup, TgpuRoot } from "typegpu";
import { arrayOf, builtin, f32, interpolate, u16, u32, vec2f, vec3f, vec4f } from "typegpu/data";
import { max } from "typegpu/std";

import { worldPerPx } from "../frame";
import { strokeLayout } from "../layout";
import { MAX_JOIN_COUNT, RUN_GEOM_TWO_POINT } from "../schemas";

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
  const f = strokeLayout.$.frame;
  const k = vec2f((f.scale * 2) / max(1, f.pane.x), (f.scale * 2) / max(1, f.pane.y));
  const ndc = vec2f(k.x * (p.x - f.cam.x), k.y * (p.y - f.cam.y));
  return vec4f(ndc * w, 0, w);
});

export const strokeVertex = tgpu.vertexFn({
  in: { instanceIndex: builtin.instanceIndex, vertexIndex: builtin.vertexIndex },
  out: {
    outPos: builtin.position,
    color: interpolate("flat", vec3f),
    alpha: interpolate("flat", f32),
  },
})(({ instanceIndex, vertexIndex }) => {
  "use gpu";
  const draw = strokeLayout.$.strokes[strokeLayout.$.strokeOrder[instanceIndex]];
  if (draw.a.radiusPx < 0 || draw.b.radiusPx < 0 || draw.c.radiusPx < 0 || draw.d.radiusPx < 0) {
    return { outPos: vec4f(), color: vec3f(), alpha: 0 };
  }
  // Half widths are CSS px in the record: the expander works in world units, so
  // one zoom-independent conversion here covers all four ctrl points.
  const w = worldPerPx(strokeLayout.$.frame.scale);
  // Two-point geometry (halo/knockout chrome of a straight stroke): a plain
  // round-capped segment between draw.b and draw.c, via lineVariableWidth.
  // Paint instances use the mirrored-neighbour polyline encoding (draw.a/d),
  // whose round joins produce the paint's round caps.
  if ((draw.run.flags & RUN_GEOM_TWO_POINT) !== u32(0)) {
    const r = lineVariableWidth(
      LineControlPoint({ position: draw.b.position, radius: draw.b.radiusPx * w }),
      LineControlPoint({ position: draw.c.position, radius: draw.c.radiusPx * w }),
      vertexIndex,
      MAX_JOIN_COUNT,
    );
    return { outPos: toClip(r.vertexPosition, r.w), color: draw.run.color, alpha: draw.run.alpha };
  }
  const result = polylineVariableWidth(
    LineControlPoint({ position: draw.a.position, radius: draw.a.radiusPx * w }),
    LineControlPoint({ position: draw.b.position, radius: draw.b.radiusPx * w }),
    LineControlPoint({ position: draw.c.position, radius: draw.c.radiusPx * w }),
    LineControlPoint({ position: draw.d.position, radius: draw.d.radiusPx * w }),
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

  // Round caps: two-point chrome instances end at their real endpoints, so the
  // cap slots draw the semicircles. Paint instances never hit the cap path
  // (their mirrored neighbours are never contained), so round is safe there too.
  const strokePipeline = root
    .with(startCapSlot, caps.round)
    .with(endCapSlot, caps.round)
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
