import { tgpu } from "typegpu";
import type { TgpuBindGroup, TgpuRoot } from "typegpu";
import { bool, builtin, f32, interpolate, u32, vec2f, vec4f } from "typegpu/data";
import { abs, atan2, clamp, dot, floor, fwidth, length, max, min, sign, sqrt } from "typegpu/std";

import { worldLayout } from "../layout";

const TAU = 6.283185307179586;

/** Angular inside-test for an arc edge: is `q` within `absSpan` of the start
 * angle `a0`, sweeping in direction `k`? TGSL has no closures, so this is a
 * module-level fn rather than an inline arrow. */
const withinArc = tgpu.fn([f32, f32, f32, f32, bool], bool)((q, k, a0, absSpan, full) => {
  "use gpu";
  if (full) return true;
  let t = k > 0 ? q - a0 : a0 - q;
  t = t - floor(t / TAU) * TAU;
  return t <= absSpan;
});

/** World → clip, same mapping as pipelines/strokes.ts toClip. */
const toClip = tgpu.fn([vec2f], vec4f)((p) => {
  "use gpu";
  const fr = worldLayout.$.frame;
  const k = vec2f(
    fr.scale * 2 / max(1, fr.pane.x),
    fr.scale * 2 / max(1, fr.pane.y),
  );
  return vec4f(k * (p - fr.cam), 0, 1);
});

const fillVertex = tgpu.vertexFn({
  in: { instanceIndex: builtin.instanceIndex, vertexIndex: builtin.vertexIndex },
  out: { outPos: builtin.position, p: interpolate("linear", vec2f), regionIndex: interpolate("flat", u32) },
})(({ instanceIndex, vertexIndex }) => {
  "use gpu";
  const slot = worldLayout.$.fillOrder[instanceIndex];
  const region = worldLayout.$.fills[slot];
  const x = vertexIndex === 1 || vertexIndex === 3 ? region.aabbMax.x : region.aabbMin.x;
  const y = vertexIndex >= 2 ? region.aabbMax.y : region.aabbMin.y;
  return { outPos: toClip(vec2f(x, y)), p: vec2f(x, y), regionIndex: slot };
});

const fillFragment = tgpu.fragmentFn({
  in: { p: interpolate("linear", vec2f), regionIndex: interpolate("flat", u32) },
  out: vec4f,
})(({ p, regionIndex }) => {
  "use gpu";
  const region = worldLayout.$.fills[regionIndex];
  let winding = 0;
  let dmin = 1e30;
  for (let i = 0; i < region.edgeCount; i++) {
    const e = worldLayout.$.fillEdges[region.edgeOffset + i];
    if (e.radius <= 0) {
      const ab = e.b - e.a;
      const ap = p - e.a;
      const denom = dot(ab, ab);
      const t = clamp(denom > 0 ? dot(ap, ab) / denom : 0, 0, 1);
      dmin = min(dmin, length(ap - ab * t));
      if ((e.a.y > p.y) !== (e.b.y > p.y)) {
        const xint = e.a.x + ((p.y - e.a.y) * (e.b.x - e.a.x)) / (e.b.y - e.a.y);
        if (xint > p.x) {
          winding += e.b.y > e.a.y ? 1 : -1;
        }
      }
    } else {
      const k = sign(e.span);
      const absSpan = abs(e.span);
      const full = absSpan >= TAU;
      const a0 = atan2(e.a.y - e.center.y, e.a.x - e.center.x);
      const v = p - e.center;
      const dist = length(v);
      if (withinArc(atan2(v.y, v.x), k, a0, absSpan, full)) {
        dmin = min(dmin, abs(dist - e.radius));
      } else {
        dmin = min(dmin, min(length(p - e.a), length(p - e.b)));
      }
      if (abs(v.y) < e.radius) {
        const dx = sqrt(e.radius * e.radius - v.y * v.y);
        let s = -1;
        while (true) {
          const cx = e.center.x + s * dx;
          if (cx > p.x && withinArc(atan2(v.y, s * dx), k, a0, absSpan, full)) {
            winding += k * (s > 0 ? 1 : -1);
          }
          if (s === 1) break;
          s = 1;
        }
      }
    }
  }
  const d = winding === 0 ? dmin : -dmin;
  const cov = clamp(0.5 - d / max(fwidth(d), 1e-6), 0, 1);
  return vec4f(region.color, region.alpha * cov);
});

const alphaBlend: GPUBlendState = {
  color: { operation: "add", srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha" },
  alpha: { operation: "add", srcFactor: "one", dstFactor: "one" },
};

export type FillPipelines = {
  fills: (pass: GPURenderPassEncoder) => {
    draw(instanceCount: number): void;
  };
  destroy(): void;
};

export function createFillPipelines(
  root: TgpuRoot,
  bindGroup: TgpuBindGroup,
  format: GPUTextureFormat,
): FillPipelines {
  const fillPipeline = root
    .createRenderPipeline({
      vertex: fillVertex,
      fragment: fillFragment,
      targets: { format, blend: alphaBlend },
      primitive: { topology: "triangle-strip" },
      multisample: { count: 4 },
    })
    .with(bindGroup);

  return {
    fills: (pass) => fillPipeline.with(pass),
    destroy: () => {},
  };
}
