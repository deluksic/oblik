import { tgpu } from "typegpu";
import type { TgpuBindGroup, TgpuRoot } from "typegpu";
import { builtin, f32, interpolate, u32, vec2f, vec3f, vec4f } from "typegpu/data";
import { max, min } from "typegpu/std";

import type { Camera2, PaneSize } from "../../../euclid2/camera";
import { gridLayout } from "../layout";

const { ceil, floor } = Math;

/** CPU-side line budget shared between the vertical and horizontal windows
 * (the old stroke-list cap, kept so zoom-out behavior is unchanged). */
const MAX_GRID_LINES = 2048;

/** Quad corners per hairline instance (triangle-strip AABB). */
export const GRID_HAIRLINE_VERTICES = 4;

export type Rgb3 = readonly [number, number, number];

export type GridSpanCpu = {
  /** First retained line coordinate per direction (window start after trimming). */
  first: { x: number; y: number };
  /** Full window rectangle; every hairline spans lo..hi along its long axis. */
  lo: { x: number; y: number };
  hi: { x: number; y: number };
  /** Retained line counts: x vertical lines (world x = first.x + i), y horizontal. */
  counts: { x: number; y: number };
  /** 1 when the world axis (x=0 vertical / y=0 horizontal) is in the retained window. */
  axis: { x: number; y: number };
};

/**
 * The grid is a pure function of the camera: the CPU only counts the visible
 * integer lines (with the old centered-window cap) and the vertex shader
 * derives every hairline position from the span uniform — a pan/zoom tick
 * writes one 40-byte uniform instead of rebuilding per-line instances.
 */
export function buildGridSpan(cam: Camera2, size: PaneSize): GridSpanCpu {
  const halfW = size.w / 2 / cam.scale + 1;
  const halfH = size.h / 2 / cam.scale + 1;
  const loX = floor(cam.x - halfW);
  const hiX = ceil(cam.x + halfW);
  const loY = floor(cam.y - halfH);
  const hiY = ceil(cam.y + halfH);
  const fullX = hiX - loX + 1;
  const fullY = hiY - loY + 1;

  // Budget order from the old stroke-list grid: verticals trimmed against the
  // full horizontal count, horizontals then against the trimmed verticals.
  const countX = Math.min(fullX, Math.max(0, MAX_GRID_LINES - fullY));
  const firstX = trimStart(loX, fullX, countX);
  const countY = Math.min(fullY, Math.max(0, MAX_GRID_LINES - countX));
  const firstY = trimStart(loY, fullY, countY);

  return {
    first: { x: firstX, y: firstY },
    lo: { x: loX, y: loY },
    hi: { x: hiX, y: hiY },
    counts: { x: countX, y: countY },
    axis: {
      x: countX > 0 && firstX <= 0 && 0 <= firstX + countX - 1 ? 1 : 0,
      y: countY > 0 && firstY <= 0 && 0 <= firstY + countY - 1 ? 1 : 0,
    },
  };
}

/** Centered trim of the inclusive integer run [lo..lo+full-1] down to `keep`. */
function trimStart(lo: number, full: number, keep: number): number {
  if (keep >= full || keep <= 0) return lo;
  return lo + Math.floor((full - keep) / 2);
}

/** World → clip, same mapping as the other pipelines. */
const toClip = tgpu.fn(
  [vec2f],
  vec4f,
)((p) => {
  "use gpu";
  const f = gridLayout.$.frame;
  const k = vec2f((f.scale * 2) / max(1, f.pane.x), (f.scale * 2) / max(1, f.pane.y));
  return vec4f(k * (p - f.cam), 0, 1);
});

/** Triangle-strip corner of the hairline quad around axis-aligned segment a→b
 * (half width hw perpendicular). A degenerate a === b quad rasterizes nothing,
 * which is how hidden axis slots stay silent. */
const quadCorner = tgpu.fn(
  [vec2f, vec2f, f32, u32],
  vec2f,
)((a, b, hw, vertexIndex) => {
  "use gpu";
  const vertical = a.x === b.x;
  const loX = min(a.x, b.x);
  const hiX = max(a.x, b.x);
  const loY = min(a.y, b.y);
  const hiY = max(a.y, b.y);
  const normal = vertical ? vec2f(1, 0) : vec2f(0, 1);
  const minP = vec2f(loX, loY) - normal * hw;
  const maxP = vec2f(hiX, hiY) + normal * hw;
  const cx = vertexIndex === u32(1) || vertexIndex === u32(3) ? maxP.x : minP.x;
  const cy = vertexIndex >= u32(2) ? maxP.y : minP.y;
  return vec2f(cx, cy);
});

/** Hairline color, filled per pipeline at creation (grid vs axis). */
const colorSlot = tgpu.slot(vec3f());

/** Grid hairlines: instance i in [0, counts.x) is the vertical line at world
 * x = first.x + i spanning lo.y..hi.y; later instances are horizontal lines at
 * world y = first.y + j spanning lo.x..hi.x. */
const gridVertex = tgpu.vertexFn({
  in: { instanceIndex: builtin.instanceIndex, vertexIndex: builtin.vertexIndex },
  out: {
    outPos: builtin.position,
    color: interpolate("flat", vec3f),
    alpha: interpolate("flat", f32),
  },
})(({ instanceIndex, vertexIndex }) => {
  "use gpu";
  const span = gridLayout.$.gridSpan;
  const f = gridLayout.$.frame;
  const hw = f32(0.5) / f.scale;
  const n = span.counts.x;
  const vertical = instanceIndex < n;
  const j = instanceIndex >= n ? instanceIndex - n : u32(0);
  const along = span.first.x + f32(instanceIndex);
  const across = span.first.y + f32(j);
  const a = vertical ? vec2f(along, span.lo.y) : vec2f(span.lo.x, across);
  const b = vertical ? vec2f(along, span.hi.y) : vec2f(span.hi.x, across);
  const p = quadCorner(a, b, hw, vertexIndex);
  return { outPos: toClip(p), color: colorSlot.$, alpha: f32(1) };
});

/** Axis hairlines: instance 0 is the world x=0 vertical axis, instance 1 the
 * world y=0 horizontal axis. Hidden slots emit a degenerate quad. */
const axisVertex = tgpu.vertexFn({
  in: { instanceIndex: builtin.instanceIndex, vertexIndex: builtin.vertexIndex },
  out: {
    outPos: builtin.position,
    color: interpolate("flat", vec3f),
    alpha: interpolate("flat", f32),
  },
})(({ instanceIndex, vertexIndex }) => {
  "use gpu";
  const span = gridLayout.$.gridSpan;
  const f = gridLayout.$.frame;
  const hw = f32(0.5) / f.scale;
  const vertical = instanceIndex === u32(0);
  const shown = vertical ? span.axis.x !== u32(0) : span.axis.y !== u32(0);
  const a = !shown ? vec2f(0, 0) : vertical ? vec2f(0, span.lo.y) : vec2f(span.lo.x, 0);
  const b = !shown ? vec2f(0, 0) : vertical ? vec2f(0, span.hi.y) : vec2f(span.hi.x, 0);
  const p = quadCorner(a, b, hw, vertexIndex);
  return { outPos: toClip(p), color: colorSlot.$, alpha: f32(1) };
});

const gridFragment = tgpu.fragmentFn({
  in: { color: interpolate("flat", vec3f), alpha: interpolate("flat", f32) },
  out: vec4f,
})(({ color, alpha }) => {
  "use gpu";
  return vec4f(color, alpha);
});

export type GridPipelines = {
  /** Grid-colored hairlines: first counts.x instances are vertical lines at
   * world x = first.x + i, the rest horizontal lines at world y = first.y + j. */
  grid: (pass: GPURenderPassEncoder) => { draw(vertexCount: number, instanceCount: number): void };
  /** Axis-colored x=0 / y=0 hairlines; instance 0 is vertical, 1 horizontal.
   * Drawn after the grid so they land on top of it. */
  axis: (pass: GPURenderPassEncoder) => { draw(vertexCount: number, instanceCount: number): void };
  /** Re-create the pipelines for new colors (theme switch). */
  setColors(colors: { grid: Rgb3; axis: Rgb3 }): void;
  destroy(): void;
};

export function createGridPipelines(
  root: TgpuRoot,
  bindGroup: TgpuBindGroup,
  format: GPUTextureFormat,
  colors: { grid: Rgb3; axis: Rgb3 },
): GridPipelines {
  const alphaBlend: GPUBlendState = {
    color: { operation: "add", srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha" },
    alpha: { operation: "add", srcFactor: "one", dstFactor: "one" },
  };
  const targets = { format, blend: alphaBlend };

  // The color slot is a pipeline-creation constant, so a theme switch rebuilds
  // the two pipelines; dropped pipeline objects are GC'd (no GPU destroy).
  const makePipeline = (rgb: Rgb3, vertex: typeof gridVertex) =>
    root
      .with(colorSlot, vec3f(rgb[0], rgb[1], rgb[2]))
      .createRenderPipeline({
        vertex,
        fragment: gridFragment,
        targets,
        primitive: { topology: "triangle-strip" },
        multisample: { count: 4 },
      })
      .with(bindGroup);
  let gridPipeline = makePipeline(colors.grid, gridVertex);
  let axisPipeline = makePipeline(colors.axis, axisVertex);

  return {
    grid: (pass) => gridPipeline.with(pass),
    axis: (pass) => axisPipeline.with(pass),
    setColors(next) {
      colors = next;
      gridPipeline = makePipeline(colors.grid, gridVertex);
      axisPipeline = makePipeline(colors.axis, axisVertex);
    },
    destroy: () => {},
  };
}
