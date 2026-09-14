/**
 * The GlyphConfig: a custom renderer for pre-baked MSDF.
 *
 * The built-in TypeGPU adapter composes `clip = M · (glyphLocalPixels +
 * position)`, so the camera and the glyph's own pixels share one matrix. An
 * affine map cannot translate a point while scaling the displacements around
 * it, so that shader can only support labels re-projected on the CPU whenever
 * the camera moves, and it cannot widen a quad to make room for a ring. Owning
 * the vertex stage fixes both — see `shader.ts` and `instance.ts`.
 *
 * The config is the engine's own contract, used as published:
 *
 * - `schema` binds the engine's typed meanings to this adapter's records.
 * - `encode` compiles the MSDF Codec — the engine's shaping and layout still
 *   fill the instance buffers, so none of that is reimplemented here.
 * - `resolve` turns the baked raster payload into an {@link OblikResource}:
 *   the atlas texture plus the one pipeline.
 * - `renderer` returns the {@link OblikRenderer} the root constructed. The root
 *   is where it is built because the root's extension is what hands the camera
 *   and the draw call to a text layer.
 * - `root.create` exposes `createText`, `setCamera` and `draw` — the whole
 *   surface a text layer needs, and nothing about glyph's own types.
 */
import type { Codec, GlyphConfigFor, GlyphRoot } from "@pmndrs/glyph";
import { resourceLease, defineGlyphConfig } from "@pmndrs/glyph/config/glyph";
import { msdf } from "@pmndrs/glyph/raster/msdf";
import type { TypeGpuFontSelection } from "@pmndrs/glyph/typegpu";
import { d, type TgpuRenderPass, type TgpuRoot } from "typegpu";

import { OblikSchema, type OblikTransform } from "./bindings";
import { oblikCodecDescriptor } from "./codec";
import { OblikRenderer, OblikResource } from "./renderer";
import { createOblikText, type OblikPlacement, type OblikText, type OblikTextOptions } from "./text";

/** Everything the adapter needs that is a property of the target, not the text. */
export type OblikConfigOptions = {
  /** Caller-owned root. Disposing the handle never destroys it. */
  readonly root: TgpuRoot;
  /** Color attachment format of the passes `draw` records into. */
  readonly format: GPUTextureFormat;
  /**
   * Sample count of that target. The painter uses 4× MSAA, so text must match
   * or pipeline creation fails — this is not a preference.
   * @default 1
   */
  readonly sampleCount?: 1 | 4 | undefined;
  /** Depth state for the pass, or omitted for a pass with no depth attachment. */
  readonly depthStencil?: GPUDepthStencilState | undefined;
};

/**
 * What a text layer holds: the engine's shaping behind `createText`, and the
 * two calls that move the camera and record the draw.
 */
export type OblikRoot = GlyphRoot & {
  createText<Selection extends TypeGpuFontSelection>(
    options: OblikTextOptions<Selection>,
    placement: OblikPlacement,
  ): OblikText<Selection>;
  /** Write the world→clip matrix. A pan or a zoom is this one call. */
  setCamera(m: readonly number[]): void;
  /** Record every accepted text into a caller-owned pass. */
  draw(
    pass: TgpuRenderPass | GPURenderPassEncoder,
    viewport: { readonly width: number; readonly height: number },
  ): void;
};

export type OblikGlyphConfig = GlyphConfigFor<
  typeof OblikSchema,
  OblikRoot,
  void,
  Codec,
  { readonly msdf: typeof msdf }
>;

const destroyTransform = (transform: OblikTransform): void => {
  transform.label.buffer.destroy();
  transform.ring.buffer.destroy();
  transform.ringColor.buffer.destroy();
};

/** Build the config. One handle per layer; the root owns the renderer. */
export function defineOblikConfig(options: OblikConfigOptions): OblikGlyphConfig {
  const sampleCount = options.sampleCount ?? 1;
  return defineGlyphConfig({
    schema: OblikSchema,
    // `default` is a key of `formats`, not a raster kind; `resolve` below is
    // handed the raster's **id** (`pmndrs.msdf`), which is what it must compare.
    fonts: { default: "msdf", formats: { msdf } },
    encode: ({ ids }) => ({ descriptor: oblikCodecDescriptor(ids) }),
    resolve: ({ format, payload }) => {
      if (format !== msdf.id) {
        throw new TypeError(`oblik renderer cannot render raster format "${format}"`);
      }
      const resource = new OblikResource(
        {
          root: options.root,
          format: options.format,
          sampleCount,
          ...(options.depthStencil === undefined ? {} : { depthStencil: options.depthStencil }),
        },
        payload,
      );
      return resourceLease(resource, () => resource.dispose());
    },
    renderer: ({ defaultRenderer }) => {
      if (defaultRenderer === undefined) {
        throw new Error("oblik renderer requires the root that constructed it");
      }
      return defaultRenderer;
    },
    root: {
      create(context) {
        const renderer = new OblikRenderer(options.root);
        const texts = new Set<OblikText>();
        const transforms = new Set<OblikTransform>();
        const retired = new Set<OblikTransform>();
        let disposed = false;
        const dispose = (): void => {
          if (disposed) return;
          disposed = true;
          for (const text of texts) text.dispose();
          for (const transform of transforms) destroyTransform(transform);
          texts.clear();
          transforms.clear();
          retired.clear();
          renderer.dispose();
        };
        try {
          return context.create(
            {
              createText<Selection extends TypeGpuFontSelection>(
                textOptions: OblikTextOptions<Selection>,
                placement: OblikPlacement,
              ): OblikText<Selection> {
                if (disposed) throw new Error("oblik root is disposed");
                // Three small uniforms per text, written by setPlacement and by
                // nothing else. The camera is not one of them.
                const transform: OblikTransform = {
                  label: options.root.createUniform(d.vec4f),
                  ring: options.root.createUniform(d.vec4f),
                  ringColor: options.root.createUniform(d.vec4f),
                };
                let text: OblikText<Selection>;
                try {
                  text = createOblikText(
                    context.fonts!,
                    context.services,
                    transform,
                    textOptions,
                    placement,
                    () => {
                      texts.delete(text);
                      transforms.delete(transform);
                      // Accepted draws may still reference this transform until
                      // the next shape(); releasing it here would be a use-after
                      // -free, so it is retired and destroyed on acceptance.
                      retired.add(transform);
                    },
                  );
                } catch (error) {
                  destroyTransform(transform);
                  throw error;
                }
                texts.add(text);
                transforms.add(transform);
                return text;
              },
              setCamera: (m) => renderer.setCamera(m),
              draw: (pass, viewport) =>
                renderer.draw(pass, viewport.width, viewport.height, []),
            },
            {
              boundary: Object.freeze({ name: context.name }),
              defaultRenderer: renderer,
              dispose,
              shape: {
                accepted: () => {
                  for (const transform of retired) destroyTransform(transform);
                  retired.clear();
                },
              },
            },
          );
        } catch (error) {
          dispose();
          throw error;
        }
      },
    },
  });
}
