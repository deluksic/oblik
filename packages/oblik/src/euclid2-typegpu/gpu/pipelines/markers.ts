import { tgpu } from "typegpu";
import type { TgpuBindGroup, TgpuRoot } from "typegpu";
import { builtin, f32, interpolate, vec2f, vec3f, vec4f } from "typegpu/data";
import { clamp, cos, max, mix, sin } from "typegpu/std";

import { markerLayout } from "../layout";

/** Screen-space square marker, drawn as a 4-triangle fan around a center
 * vertex. Per-vertex `dist` is 0 at the center and 1 at the outer corners, so
 * inside each triangle the isocontours run parallel to its edge: the
 * interpolated value is the normalized perpendicular distance to that edge and
 * its level sets are concentric squares/diamonds. Coloring by it gives straight
 * edges and true corners (no `max(|x|,|y|)` coverage, which bulges convex
 * corners into a round shape), and `fwidth(dist)` is a real edge-distance AA
 * ramp. `angle` rotates in screen space, so π/4 draws a diamond. */
const markerVertex = tgpu.vertexFn({
  in: { instanceIndex: builtin.instanceIndex, vertexIndex: builtin.vertexIndex },
  out: {
    outPos: builtin.position,
    /** 0 at the center, 1 at the outer boundary. */
    dist: interpolate("linear", f32),
    halfInner: interpolate("flat", f32),
    halfOuter: interpolate("flat", f32),
    fill: interpolate("flat", vec3f),
    stroke: interpolate("flat", vec3f),
    alpha: interpolate("flat", f32),
  },
})(({ instanceIndex, vertexIndex }) => {
  "use gpu";
  const fr = markerLayout.$.frame;
  const inst = markerLayout.$.marks[markerLayout.$.markOrder[instanceIndex]];
  // 12 vertices = 4 triangles: (center, corner j, corner j+1).
  const tri = Math.floor(vertexIndex / 3);
  const k = vertexIndex % 3;
  const center = k === 0;
  // Corner index 0..3 → (+x/+y) signs; the center vertex overrides `local`.
  const jf = f32(tri) + f32(k) - 1;
  const j = jf - Math.floor(jf / 4) * 4;
  const sx = j < 0.5 || j > 2.5 ? -1 : 1;
  const sy = j > 1.5 ? 1 : -1;
  const local = center ? vec2f(0, 0) : vec2f(sx, sy) * inst.halfOuter;
  // World → screen px, matching euclid2/camera.ts worldToScreen (y down).
  const screenCenter = vec2f(
    fr.pane.x * 0.5 + (inst.center.x - fr.cam.x) * fr.scale,
    fr.pane.y * 0.5 - (inst.center.y - fr.cam.y) * fr.scale,
  );
  const c = cos(inst.angle);
  const s = sin(inst.angle);
  const screen = screenCenter + vec2f(c * local.x - s * local.y, s * local.x + c * local.y);
  return {
    outPos: vec4f(
      (screen.x * 2) / max(1, fr.pane.x) - 1,
      1 - (screen.y * 2) / max(1, fr.pane.y),
      0,
      1,
    ),
    dist: center ? 0 : 1,
    halfInner: inst.halfInner,
    halfOuter: inst.halfOuter,
    fill: inst.fill,
    stroke: inst.stroke,
    alpha: inst.alpha,
  };
});

const markerFragment = tgpu.fragmentFn({
  in: {
    dist: interpolate("linear", f32),
    halfInner: interpolate("flat", f32),
    halfOuter: interpolate("flat", f32),
    fill: interpolate("flat", vec3f),
    stroke: interpolate("flat", vec3f),
    alpha: interpolate("flat", f32),
  },
  out: vec4f,
})(({ dist, halfInner, halfOuter, fill, stroke, alpha }) => {
  "use gpu";
  // `dist` is normalized perpendicular distance, so dist·halfOuter is that
  // distance in CSS px: a fixed 1px ramp at the inner boundary, with no
  // derivative estimate (whose result is ill-defined on the triangle seams
  // that run along the marker's diagonals). The outer boundary is the geometry
  // itself, antialiased by 4× MSAA.
  const perp = dist * halfOuter;
  const covInner = clamp(0.5 + halfInner - perp, 0, 1);
  return vec4f(mix(stroke, fill, covInner), alpha);
});

const alphaBlend: GPUBlendState = {
  color: { operation: "add", srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha" },
  alpha: { operation: "add", srcFactor: "one", dstFactor: "one" },
};

/** Fan vertices per instance: 4 triangles × 3. */
export const MARKER_VERTEX_COUNT = 12;

export type MarkerPipelines = {
  markers: (pass: GPURenderPassEncoder) => {
    draw(vertexCount: number, instanceCount: number): void;
  };
};

export function createMarkerPipelines(
  root: TgpuRoot,
  bindGroup: TgpuBindGroup,
  format: GPUTextureFormat,
): MarkerPipelines {
  const markerPipeline = root
    .createRenderPipeline({
      vertex: markerVertex,
      fragment: markerFragment,
      targets: { format, blend: alphaBlend },
      primitive: { topology: "triangle-list" },
      multisample: { count: 4 },
    })
    .with(bindGroup);

  return {
    markers: (pass) => markerPipeline.with(pass),
  };
}
