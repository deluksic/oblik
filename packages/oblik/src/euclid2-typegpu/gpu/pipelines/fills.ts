import { tgpu } from "typegpu";
import type { TgpuBindGroup, TgpuRoot } from "typegpu";
import { bool, builtin, f32, interpolate, u32, vec2f, vec4f } from "typegpu/data";
import { abs, atan2, clamp, dot, floor, length, max, min, sign, sqrt } from "typegpu/std";

import { QUAD_PAD_PX, worldPerPx } from "../frame";
import { fillLayout } from "../layout";
import { haloWithEdge, paintWithEdge } from "./halo";

const TAU = 6.283185307179586;

/** Angular inside-test for an arc edge: is `q` within `absSpan` of the start
 * angle `a0`, sweeping in direction `k`? TGSL has no closures, so this is a
 * module-level fn rather than an inline arrow. */
const withinArc = tgpu.fn(
  [f32, f32, f32, f32, bool],
  bool,
)((q, k, a0, absSpan, full) => {
  "use gpu";
  if (full) return true;
  let t = k > 0 ? q - a0 : a0 - q;
  t = t - floor(t / TAU) * TAU;
  return t <= absSpan;
});

/** World → clip, same mapping as pipelines/strokes.ts toClip. */
const toClip = tgpu.fn(
  [vec2f],
  vec4f,
)((p) => {
  "use gpu";
  const fr = fillLayout.$.frame;
  const k = vec2f((fr.scale * 2) / max(1, fr.pane.x), (fr.scale * 2) / max(1, fr.pane.y));
  return vec4f(k * (p - fr.cam), 0, 1);
});

const fillVertex = tgpu.vertexFn({
  in: { instanceIndex: builtin.instanceIndex, vertexIndex: builtin.vertexIndex },
  out: {
    outPos: builtin.position,
    p: interpolate("linear", vec2f),
    regionIndex: interpolate("flat", u32),
  },
})(({ instanceIndex, vertexIndex }) => {
  "use gpu";
  const slot = fillLayout.$.fillOrder[instanceIndex];
  const region = fillLayout.$.fills[slot];
  // The stored AABB is pure world geometry (no camera in it); the AA skirt is a
  // screen-space width, so it is applied here — outward from the box, which is
  // what the CPU's `growBox(box, 2 / scale)` used to do before the draw.
  const pad = QUAD_PAD_PX * worldPerPx(fillLayout.$.frame.scale);
  const x =
    vertexIndex === 1 || vertexIndex === 3 ? region.aabbMax.x + pad : region.aabbMin.x - pad;
  const y = vertexIndex >= 2 ? region.aabbMax.y + pad : region.aabbMin.y - pad;
  return { outPos: toClip(vec2f(x, y)), p: vec2f(x, y), regionIndex: slot };
});

/** Signed distance to one span region's boundary (negative inside): winding for
 * the sign, nearest boundary for the magnitude. Shared by the paint and halo
 * fragments — the halo is a band of this same field. */
const spanDistance = tgpu.fn(
  [u32, vec2f],
  f32,
)((regionIndex, p) => {
  "use gpu";
  const region = fillLayout.$.fills[regionIndex];
  let winding = 0;
  let dmin = 1e30;
  // Segments and arcs are separate arrays with separate windows: the segment
  // loop reads 16 B records and never branches on a carrier it cannot have.
  const segEnd = region.segOffset + region.segCount;
  for (let i = region.segOffset; i < segEnd; i += 1) {
    const e = fillLayout.$.fillSegs[i];
    const ab = e.b - e.a;
    const ap = p - e.a;
    const denom = dot(ab, ab);
    const t = clamp(denom > 0 ? dot(ap, ab) / denom : 0, 0, 1);
    dmin = min(dmin, length(ap - ab * t));
    if (e.a.y > p.y !== e.b.y > p.y) {
      const xint = e.a.x + ((p.y - e.a.y) * (e.b.x - e.a.x)) / (e.b.y - e.a.y);
      if (xint > p.x) {
        winding += e.b.y > e.a.y ? 1 : -1;
      }
    }
  }
  const arcEnd = region.arcOffset + region.arcCount;
  for (let i = region.arcOffset; i < arcEnd; i += 1) {
    const e = fillLayout.$.fillArcs[i];
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
      let s = f32(-1);
      while (true) {
        const cx = e.center.x + s * dx;
        if (cx > p.x && withinArc(atan2(v.y, s * dx), k, a0, absSpan, full)) {
          winding += (e.span > 0 ? 1 : -1) * (s > 0 ? 1 : -1);
        }
        if (s === f32(1)) break;
        s = f32(1);
      }
    }
  }
  return winding === 0 ? dmin : -dmin;
});

export const fillFragment = tgpu.fragmentFn({
  in: { p: interpolate("linear", vec2f), regionIndex: interpolate("flat", u32) },
  out: vec4f,
})(({ p, regionIndex }) => {
  "use gpu";
  const region = fillLayout.$.fills[regionIndex];
  return paintWithEdge(
    spanDistance(regionIndex, p),
    vec4f(region.color, region.alpha),
    region.edge,
    region.edgeWidthPx * worldPerPx(fillLayout.$.frame.scale),
  );
});

/** Halo entry: the same region, drawn as the inward chrome band, with the
 * node's own outline kept above it. */
export const haloFragment = tgpu.fragmentFn({
  in: { p: interpolate("linear", vec2f), regionIndex: interpolate("flat", u32) },
  out: vec4f,
})(({ p, regionIndex }) => {
  "use gpu";
  const region = fillLayout.$.fills[regionIndex];
  const w = worldPerPx(fillLayout.$.frame.scale);
  return haloWithEdge(
    spanDistance(regionIndex, p),
    region.haloRing,
    region.haloKnock,
    region.haloHalfPx * w,
    region.edge,
    region.edgeWidthPx * w,
  );
});

const alphaBlend: GPUBlendState = {
  color: { operation: "add", srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha" },
  alpha: { operation: "add", srcFactor: "one", dstFactor: "one" },
};

/** Quad corners per region instance (triangle-strip AABB). */
export const FILL_QUAD_VERTICES = 4;

export type FillPipelines = {
  fills: (pass: GPURenderPassEncoder) => {
    /** `firstInstance` picks a run's start in the shared order array, which is
     * how the painter interleaves span fills with compiled fields. */
    draw(
      vertexCount: number,
      instanceCount: number,
      firstVertex?: number,
      firstInstance?: number,
    ): void;
  };
  /** The same regions drawn as the inward halo band (see `halo.ts`). */
  halos: (pass: GPURenderPassEncoder) => {
    draw(
      vertexCount: number,
      instanceCount: number,
      firstVertex?: number,
      firstInstance?: number,
    ): void;
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
  const haloPipeline = root
    .createRenderPipeline({
      vertex: fillVertex,
      fragment: haloFragment,
      targets: { format, blend: alphaBlend },
      primitive: { topology: "triangle-strip" },
      multisample: { count: 4 },
    })
    .with(bindGroup);

  return {
    fills: (pass) => fillPipeline.with(pass),
    halos: (pass) => haloPipeline.with(pass),
    destroy: () => {},
  };
}
