import {
  caps,
  endCapSlot,
  lineSegmentIndices,
  LineControlPoint,
  lineVariableWidth,
  startCapSlot,
} from "@typegpu/geometry";
import { tgpu } from "typegpu";
import type { TgpuBindGroup, TgpuRoot } from "typegpu";
import { arrayOf, builtin, f32, interpolate, u16, u32, vec2f, vec3f, vec4f } from "typegpu/data";
import { max, select } from "typegpu/std";

import { worldPerPx } from "../frame";
import { strokeLayout } from "../layout";
import {
  LAYER_HALO,
  LAYER_KNOCKOUT,
  LAYER_PAINT,
  MAX_JOIN_COUNT,
  STATE_EDITABLE,
  STATE_EXPLICIT,
  STATE_HOT,
  STATE_MUTED,
  STATE_SELECTED,
} from "../schemas";

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

/**
 * A stroke band's vertex shader, compiled for that band's layers.
 *
 * The record says what is true of the *node* — its run, its paint half width,
 * and a state word — and the band says which layer is drawing. So the shader has
 * its base layer and its layer count baked in, and picks an instance's layer from
 * the instance's parity: a band's layers are adjacent by construction, which is
 * what `bands.ts` promises and what lets one record stand for all of them. There
 * is nothing in a record that says "halo" or "paint", and nothing here that
 * renumbers a layer.
 */
function makeStrokeVertex(base: number, count: number) {
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
    const rec = strokeLayout.$.strokes[strokeLayout.$.strokeOrder[instanceIndex / u32(count)]];
    const chrome = strokeLayout.$.chrome;
    const hot = (rec.state & u32(STATE_HOT)) !== u32(0);
    const selected = (rec.state & u32(STATE_SELECTED)) !== u32(0);
    const editable = (rec.state & u32(STATE_EDITABLE)) !== u32(0);
    const muted = (rec.state & u32(STATE_MUTED)) !== u32(0);
    const explicit = (rec.state & u32(STATE_EXPLICIT)) !== u32(0);
    // The record's half width is the paint's; the chrome bands take the frame's
    // two thicknesses and place them outside it, and a band that is not drawing
    // is a zero width, never a flag.
    let halfPx = rec.halfPx;
    let color = select(chrome.ink, select(chrome.accent, chrome.selectedPaint, hot), editable);
    let alpha = select(f32(1), chrome.mutedAlpha, muted);
    if (explicit) {
      // The tool overlay's own colour and alpha. Scene ink never sets the bit,
      // so its colour lane stays empty and the state derives it instead.
      color = vec3f(rec.color);
      alpha = f32(rec.alpha);
    } else if (layer === u32(LAYER_HALO)) {
      // A hovered ring hugs the paint; selecting inserts the paper gap between
      // the two, which pushes the ring out by exactly that gap. The ring's own
      // thickness never changes, so hovering does not fatten it (the fills'
      // model, measured outward from the paint instead of inward from a fill).
      halfPx = rec.halfPx + chrome.ringPx + select(f32(0), chrome.gapPx, selected);
      color = vec3f(chrome.ring);
      alpha = select(chrome.hoverAlpha, chrome.selectAlpha, selected);
    } else if (layer === u32(LAYER_KNOCKOUT)) {
      // The paper is the band that only a selection has: it is the gap.
      halfPx = select(f32(0), rec.halfPx + chrome.gapPx, selected);
      color = vec3f(chrome.paper);
      alpha = f32(1);
    }
    // A dead band draws nothing, and it has to be culled here: the expander's
    // homogeneous weight is `1 / radius`.
    if (halfPx <= 0) {
      return { outPos: vec4f(), color: vec3f(), alpha: 0 };
    }
    // Half widths are CSS px in the record: the expander works in world units, so
    // one zoom-independent conversion here covers both endpoints.
    const w = worldPerPx(strokeLayout.$.frame.scale);
    const r = lineVariableWidth(
      LineControlPoint({ position: rec.a, radius: halfPx * w }),
      LineControlPoint({ position: rec.b, radius: halfPx * w }),
      vertexIndex,
      MAX_JOIN_COUNT,
    );
    return { outPos: toClip(r.vertexPosition, r.w), color, alpha };
  });
}

/** The paint band replays the record itself. */
export const strokeVertexPaint = makeStrokeVertex(LAYER_PAINT, 1);
/** A chrome band replays the adjacent halo/knockout pair off one entry. */
export const strokeVertexHalo = makeStrokeVertex(LAYER_HALO, 2);

/** The shader a band draws with, from the band's layers (`bands.ts`). Throwing
 * rather than defaulting is deliberate: a band whose base layer has no shader is
 * a band that would draw nothing. */
export function strokeVertexFor(layers: readonly number[]): typeof strokeVertexPaint {
  const base = layers[0]!;
  if (base === LAYER_PAINT) return strokeVertexPaint;
  if (base === LAYER_HALO) return strokeVertexHalo;
  throw new Error(`no stroke shader is built for a band based on layer ${base}`);
}

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
  layers: readonly number[],
): StrokePipelines {
  const indices = lineSegmentIndices(MAX_JOIN_COUNT);
  const indexBuffer = root.createBuffer(arrayOf(u16, indices.length), indices).$usage("index");
  const indexCount = indices.length;

  const targets = { format, blend: alphaBlend };

  // Round caps: the run's own endpoints are what the record carries, so the cap
  // slots draw the semicircles at both ends.
  const strokePipeline = root
    .with(startCapSlot, caps.round)
    .with(endCapSlot, caps.round)
    .createRenderPipeline({
      vertex: strokeVertexFor(layers),
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
