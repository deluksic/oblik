import { circle, circleVertexCount } from "@typegpu/geometry";
import { tgpu } from "typegpu";
import type { TgpuBindGroup, TgpuRoot } from "typegpu";
import { builtin, f32, interpolate, u32, vec2f, vec3f, vec4f } from "typegpu/data";
import { max, select } from "typegpu/std";

import { worldPerPx } from "../frame";
import { diskLayout } from "../layout";
import {
  LAYER_HALO,
  LAYER_KNOCKOUT,
  LAYER_OUTLINE,
  LAYER_PAINT,
  STATE_EDITABLE,
  STATE_EXPLICIT,
  STATE_HOT,
  STATE_MUTED,
  STATE_SELECTED,
} from "../schemas";

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

/**
 * A mark band's vertex shader, compiled for that band's layers.
 *
 * The four concentric discs the SVG PointMark composes are this record's four
 * layers, and each layer's radius is the mark's own paint radius plus an offset
 * the frame carries — so the record holds the one number the SVG's chrome recipe
 * measures from and nothing that a band could derive. Like the stroke shader,
 * the base layer and the layer count are baked in and an instance's layer comes
 * from its parity: a mark's paint band is the rim+paint pair, its chrome band the
 * ring+knockout pair.
 */
function makeMarkVertex(base: number, count: number) {
  return tgpu.vertexFn({
    in: { instanceIndex: builtin.instanceIndex, vertexIndex: builtin.vertexIndex },
    out: {
      outPos: builtin.position,
      color: interpolate("flat", vec3f),
      alpha: interpolate("flat", f32),
    },
  })(({ instanceIndex, vertexIndex }) => {
    "use gpu";
    const layer = u32(base) + (instanceIndex % u32(count));
    const rec = diskLayout.$.points[diskLayout.$.pointOrder[instanceIndex / u32(count)]];
    const chrome = diskLayout.$.chrome;
    const hot = (rec.state & u32(STATE_HOT)) !== u32(0);
    const selected = (rec.state & u32(STATE_SELECTED)) !== u32(0);
    const editable = (rec.state & u32(STATE_EDITABLE)) !== u32(0);
    const muted = (rec.state & u32(STATE_MUTED)) !== u32(0);
    const explicit = (rec.state & u32(STATE_EXPLICIT)) !== u32(0);
    let radiusPx = rec.markRadiusPx;
    let color = select(chrome.ink, select(chrome.accent, chrome.selectedPaint, hot), editable);
    let alpha = select(f32(1), chrome.mutedAlpha, muted);
    if (layer === u32(LAYER_OUTLINE)) {
      // The always-on paper rim under the paint: the SVG's own paint stroke,
      // which is why it fades with the mark rather than being chrome.
      radiusPx = rec.markRadiusPx + chrome.pointOutlineAddPx;
      color = vec3f(chrome.paper);
    } else if (layer === u32(LAYER_HALO)) {
      // A halo is a full disc out to the ring radius, under the dot.
      radiusPx = select(f32(0), rec.markRadiusPx + chrome.pointRingAddPx, hot);
      color = vec3f(chrome.ring);
      alpha = select(chrome.hoverAlpha, chrome.selectAlpha, selected);
    } else if (layer === u32(LAYER_KNOCKOUT)) {
      radiusPx = select(f32(0), rec.markRadiusPx + chrome.pointKnockAddPx, selected);
      color = vec3f(chrome.paper);
      alpha = f32(1);
    }
    if (explicit) {
      // The overlay's own dots: one instance, the record's colour and radius.
      radiusPx = f32(rec.markRadiusPx);
      color = vec3f(rec.color);
      alpha = f32(rec.alpha);
    }
    // Inactive layers are a zero radius, and fully transparent ink is pointless
    // to rasterize: both cull here rather than at the fragment.
    if (radiusPx <= 0 || alpha <= 0) {
      return { outPos: vec4f(0, 0, -2, 1), color: vec3f(), alpha: 0 };
    }
    const radius = radiusPx * worldPerPx(diskLayout.$.frame.scale);
    const pos = rec.center + circle(vertexIndex) * radius;
    return { outPos: toClip(pos), color, alpha };
  });
}

/** A mark's paint band: the paper rim, then the paint disc. */
export const markVertexPaint = makeMarkVertex(LAYER_OUTLINE, 2);
/** A mark's chrome band: the ring, then the selected knockout. */
export const markVertexHalo = makeMarkVertex(LAYER_HALO, 2);
/** The tool overlay's dots: one layer, drawn from the record's own colour. */
export const markVertexExplicit = makeMarkVertex(LAYER_PAINT, 1);

/** The shader a band draws with, from the band's layers (`bands.ts`). */
export function markVertexFor(layers: readonly number[]): typeof markVertexPaint {
  const base = layers[0]!;
  if (base === LAYER_OUTLINE) return markVertexPaint;
  if (base === LAYER_HALO) return markVertexHalo;
  if (base === LAYER_PAINT) return markVertexExplicit;
  throw new Error(`no mark shader is built for a band based on layer ${base}`);
}

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
  layers: readonly number[],
): DiskPipelines {
  const diskPipeline = root
    .createRenderPipeline({
      vertex: markVertexFor(layers),
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
