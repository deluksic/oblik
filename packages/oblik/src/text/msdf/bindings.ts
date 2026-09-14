/**
 * This renderer's binding vocabulary: the names the engine's Codec hands to the
 * renderer, and what this adapter makes of each one.
 *
 * A `GlyphConfig` schema is the seam between the two. The engine owns *what*
 * happens — shaping, layout, batching, ordinals — and speaks in typed bindings;
 * a renderer decides what those mean. Everything here is a pass-through except
 * `instance`, which is where the renderer finds its own transform and its own
 * instance range.
 *
 * The bindings deliberately do not carry the pipeline: `OblikResolvedResource`
 * is the resource the config's `resolve` hook produced, and the renderer reads
 * `prepare` off it. Keeping that interface here — rather than importing the
 * renderer — is what keeps `config → renderer → bindings` acyclic, which the
 * lint config enforces in spirit if not in letter.
 */
import type {
  CodecProgram,
  GlyphBatchBindingInput,
  GlyphBindingSet,
  GlyphBufferBindingInput,
  GlyphInstanceSpanBindingInput,
  GlyphRootInstanceBindingInput,
  GlyphSchema,
  PortableResource,
} from "@pmndrs/glyph";
import { defineGlyphSchema } from "@pmndrs/glyph/config/glyph";
import type { CodecBufferId } from "@pmndrs/glyph/config/codec";
import type { TgpuBindGroup, TgpuRenderPass, TgpuUniform } from "typegpu";
import type { Mat4x4f, Vec4f } from "typegpu/data";

/** The two per-frame uniforms the renderer owns; a camera move writes these. */
export type OblikFrame = {
  readonly camera: TgpuUniform<Mat4x4f>;
  readonly view: TgpuUniform<Vec4f>;
};

/**
 * The per-text uniforms. `setPlacement` writes exactly these, so moving a label
 * costs twelve floats and no re-shaping.
 */
export type OblikTransform = {
  readonly label: TgpuUniform<Vec4f>;
  readonly ring: TgpuUniform<Vec4f>;
  readonly ringColor: TgpuUniform<Vec4f>;
};

/** One prepared draw, already bound to a pipeline and its buffers. */
export interface OblikDraw {
  draw(pass: TgpuRenderPass | GPURenderPassEncoder, bindGroups: readonly TgpuBindGroup[]): void;
}

/**
 * One span's two stages.
 *
 * They are kept apart rather than composited in one quad because glyphs overlap:
 * a ring drawn with its own fill paints paper over the neighbouring glyph's ink
 * wherever kerning brings the boxes together. The renderer records every `band`
 * before any `fill`.
 */
export interface OblikPreparedSpan {
  /** The knockout band, for the ring colour. */
  readonly band: OblikDraw;
  /** The glyph itself, recorded on top of every band. */
  readonly fill: OblikDraw;
}

/** The renderer's own resource: the atlas, the pipeline, and how to bind a span. */
export interface OblikResolvedResource {
  prepare(
    buffers: ReadonlyMap<CodecBufferId, GPUBuffer>,
    frame: OblikFrame,
    transform: OblikTransform,
    start: number,
    count: number,
  ): OblikPreparedSpan;
  dispose(): void;
}

export interface OblikProgramBinding {
  readonly kind: "oblik-program";
  readonly program: CodecProgram;
}
export interface OblikBufferBinding {
  readonly kind: "oblik-buffer";
  readonly input: GlyphBufferBindingInput<OblikProgramBinding>;
}
export interface OblikInstanceSpanBinding {
  readonly kind: "oblik-span";
  readonly input: GlyphInstanceSpanBindingInput<
    OblikResolvedResource,
    OblikBufferBinding,
    OblikProgramBinding
  >;
}
export interface OblikBatchBinding {
  readonly kind: "oblik-batch";
  readonly input: GlyphBatchBindingInput<
    OblikResolvedResource,
    OblikBufferBinding,
    OblikProgramBinding,
    OblikMaterial,
    OblikInstanceSpanBinding
  >;
}
export interface OblikInstanceBinding {
  readonly kind: "oblik-instance";
  readonly input: GlyphRootInstanceBindingInput<
    OblikResolvedResource,
    OblikBufferBinding,
    OblikProgramBinding,
    OblikMaterial,
    OblikTransform,
    OblikInstanceSpanBinding
  >;
}

/** This renderer has no material concept: a Text is its own record. */
export type OblikMaterial = { readonly kind: "oblik-material" };

export interface OblikBindings extends GlyphBindingSet {
  readonly resource: OblikResolvedResource;
  readonly buffer: OblikBufferBinding;
  readonly program: OblikProgramBinding;
  readonly material: OblikMaterial;
  readonly transform: OblikTransform;
  readonly batch: OblikBatchBinding;
  readonly instance: OblikInstanceBinding;
  readonly instanceSpan: OblikInstanceSpanBinding;
  readonly materialInput: OblikMaterial;
  readonly transformInput: OblikTransform;
}

/** Boundary state a renderer gets at construction; only the name is meaningful. */
export interface OblikRootContext {
  readonly name: string | undefined;
}

/** Pass-through schema: the renderer's work happens on the instance binding. */
export const OblikSchema: GlyphSchema<OblikBindings, OblikRootContext> = defineGlyphSchema({
  program: (_root, program) => Object.freeze({ kind: "oblik-program", program }),
  buffer: (_root, input) => Object.freeze({ kind: "oblik-buffer", input }),
  material: (_root, material) => material,
  transform: (_root, transform) => transform,
  batch: (_root, input) => Object.freeze({ kind: "oblik-batch", input }),
  instance: (_root, input) => Object.freeze({ kind: "oblik-instance", input }),
  instanceSpan: (_root, input) => Object.freeze({ kind: "oblik-span", input }),
});

/** What `resolve` hands back: the payload plus its own name, for diagnostics. */
export interface OblikResourceLeaseValue {
  readonly name: string;
  readonly resource: PortableResource;
}
