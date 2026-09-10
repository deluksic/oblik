import { circle, circleVertexCount } from "@typegpu/geometry";
import { tgpu } from "typegpu";
import type { TgpuBindGroup, TgpuRoot } from "typegpu";
import { builtin, f32, interpolate, vec2f, vec3f, vec4f } from "typegpu/data";
import { max } from "typegpu/std";

import { worldPerPx } from "../frame";
import { diskLayout } from "../layout";

/** World → clip, same mapping as pipelines/circles.ts toClip. */
const toClip = tgpu.fn(
  [vec2f],
  vec4f,
)((p) => {
  "use gpu";
  const f = diskLayout.$.frame;
  const k = vec2f((f.scale * 2) / max(1, f.pane.x), (f.scale * 2) / max(1, f.pane.y));
  return vec4f(k * (p - f.cam), 0, 1);
});

export const diskVertex = tgpu.vertexFn({
  in: { instanceIndex: builtin.instanceIndex, vertexIndex: builtin.vertexIndex },
  out: {
    outPos: builtin.position,
    color: interpolate("flat", vec3f),
    alpha: interpolate("flat", f32),
  },
})(({ instanceIndex, vertexIndex }) => {
  "use gpu";
  const inst = diskLayout.$.points[diskLayout.$.pointOrder[instanceIndex]];
  // Inactive disc layers are culled (radiusPx <= 0); fully transparent paint is
  // pointless to rasterize (alpha <= 0).
  if (inst.radiusPx <= 0 || inst.alpha <= 0) {
    return { outPos: vec4f(0, 0, -2, 1), color: vec3f(), alpha: 0 };
  }
  const radius = inst.radiusPx * worldPerPx(diskLayout.$.frame.scale);
  const pos = inst.center + circle(vertexIndex) * radius;
  return { outPos: toClip(pos), color: inst.color, alpha: inst.alpha };
});

const diskFragment = tgpu.fragmentFn({
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

/** One subdivided triangle-list disk per instance (subdiv 4, as upstream). */
export const DISK_VERTEX_COUNT = circleVertexCount(4);

export type DiskPipelines = {
  points: (pass: GPURenderPassEncoder) => {
    draw(vertexCount: number, instanceCount: number): void;
  };
};

export function createDiskPipelines(
  root: TgpuRoot,
  bindGroup: TgpuBindGroup,
  format: GPUTextureFormat,
): DiskPipelines {
  const diskPipeline = root
    .createRenderPipeline({
      vertex: diskVertex,
      fragment: diskFragment,
      targets: { format, blend: alphaBlend },
      primitive: { topology: "triangle-list" },
      multisample: { count: 4 },
    })
    .with(bindGroup);

  return {
    points: (pass) => diskPipeline.with(pass),
  };
}
