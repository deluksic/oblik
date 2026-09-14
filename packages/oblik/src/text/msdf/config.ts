/**
 * The GlyphConfig: a custom renderer for pre-baked MSDF, following
 * `glyph-example-renderer/config.ts` — the official pattern for this, and the
 * canary that the public API suffices without reaching into package internals.
 *
 * Why a custom renderer at all: the built-in TypeGPU adapter composes
 * `clip = M · (glyphLocalPixels + position)`, so the camera and the glyph's own
 * pixels share one matrix. An affine matrix cannot translate a point while
 * scaling the displacements around it, so that shader can only support labels
 * re-projected on the CPU whenever the camera moves, and it cannot widen a quad
 * to make room for an outline band. Owning the vertex shader fixes both.
 */
import { glyph } from "@pmndrs/glyph";
import type {
  Codec,
  CodecProgram,
  GlyphBatchBindingInput,
  GlyphBindingSet,
  GlyphBufferBindingInput,
  GlyphConfigFor,
  GlyphHandle,
  GlyphInstanceSpanBindingInput,
  GlyphRoot,
  GlyphRootInstanceBindingInput,
  GlyphRootServices,
  GlyphSchema,
  PortableResource,
} from "@pmndrs/glyph";
import { defineGlyphConfig, defineGlyphSchema, resourceLease } from "@pmndrs/glyph/config/glyph";
import { msdf } from "@pmndrs/glyph/raster/msdf";

import { oblikCodecDescriptor } from "./codec";

export interface OblikResolvedResource {
  readonly name: string;
  readonly resource: PortableResource;
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
/** This renderer has no material or transform concept: a Text is its own record. */
export interface OblikMaterial {
  readonly kind: "oblik-material";
}
export interface OblikTransform {
  readonly kind: "oblik-transform";
}

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

export interface OblikRootContext {
  readonly name: string | undefined;
}

/** Pass-through schema: the span binding is where the renderer finds its range. */
export const OblikSchema: GlyphSchema<OblikBindings, OblikRootContext> = defineGlyphSchema({
  program: (_root, program) => Object.freeze({ kind: "oblik-program", program }),
  buffer: (_root, input) => Object.freeze({ kind: "oblik-buffer", input }),
  material: (_root, material) => material,
  transform: (_root, transform) => transform,
  batch: (_root, input) => Object.freeze({ kind: "oblik-batch", input }),
  instance: (_root, input) => Object.freeze({ kind: "oblik-instance", input }),
  instanceSpan: (_root, input) => Object.freeze({ kind: "oblik-span", input }),
});

export type OblikRoot = GlyphRoot;
export type OblikHandle = GlyphHandle<OblikRoot>;

export type OblikGlyphConfig = GlyphConfigFor<
  typeof OblikSchema,
  OblikRoot,
  void,
  Codec,
  { readonly msdf: typeof msdf }
>;

/** Build the config; the official example's shape, minus what we do not need. */
export function defineOblikConfig(): OblikGlyphConfig {
  return defineGlyphConfig({
    schema: OblikSchema,
    fonts: { default: msdf.kind, formats: { msdf } },
    encode: ({ ids }) => ({ descriptor: oblikCodecDescriptor(ids) }),
    resolve: ({ format, resourceName, payload }) => {
      if (format !== msdf.kind) {
        throw new TypeError(`oblik renderer cannot render raster format "${format}"`);
      }
      return resourceLease(
        Object.freeze({ name: resourceName, resource: payload }),
        () => undefined,
      );
    },
    renderer: () => {
      throw new Error("oblik renderer not wired yet");
    },
    root: {
      create: (context) => {
        const services: GlyphRootServices<OblikBindings, void, OblikRootContext> = context.services;
        void services;
        return context.create(
          {},
          {
            boundary: Object.freeze({ name: context.name }),
            shape: { accepted: () => undefined },
          },
        );
      },
    },
  });
}

void glyph;
