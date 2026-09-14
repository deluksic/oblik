/**
 * The renderer: glyph's Codec on one side, this project's shaders on the other.
 *
 * Glyph owns shaping, layout, batching and the instance buffers it fills; a
 * `GlyphRenderer` decides what those buffers are drawn with. This one is the
 * built-in TypeGPU renderer's *shape* with two changes that matter:
 *
 * 1. **The transform is per text and this renderer writes it directly.** The
 *    engine hands each span its own transform record; a label that moves writes
 *    twelve floats there. Nothing about a camera appears in it, which is why a
 *    pan touches no instance buffer and no text.
 *
 * 2. **Buffers are uploaded whole, not range-coalesced.** The built-in coalesces
 *    upload ranges because it expects heavy per-frame edits; here a camera move
 *    produces no buffer patch at all and a label move is a handful of records,
 *    so the bookkeeping would cost more than the bytes. The retained CPU copy is
 *    still authoritative and commits only on `commit()`, so a rejected frame
 *    leaves the last accepted state untouched.
 *
 * The frame uniforms live here rather than in the config so that the same
 * renderer instance is reachable from the root's extension — the layer writes
 * the camera through the root, and the resource binds it through `prepare`.
 */
import type { CodecBufferId } from "@pmndrs/glyph/config/codec";
import type {
  CommandBufferView,
  GlyphRenderer,
  PortableLeafResource,
  PortableResource,
  PreparedRendererCommit,
} from "@pmndrs/glyph";
import type {
  TgpuBindGroup,
  TgpuRenderPass,
  TgpuRenderPipeline,
  TgpuRoot,
} from "typegpu";
import { d, tgpu } from "typegpu";

import {
  type OblikBindings,
  type OblikBufferBinding,
  type OblikDraw,
  type OblikFrame,
  type OblikPreparedSpan,
  type OblikResolvedResource,
  type OblikTransform,
} from "./bindings";
import { oblikBandFragment, oblikFillFragment } from "./fragment";
import { oblikLayout } from "./instance";
import { oblikVertex } from "./shader";
import { msdfSchema } from "@pmndrs/glyph/raster/msdf";

/** One vertex attribute per layout: the engine's MSDF lanes, in its own order. */
const rectLayout = tgpu.vertexLayout(d.disarrayOf(d.float32x4), "instance");
const uvRectLayout = tgpu.vertexLayout(d.disarrayOf(d.float32x4), "instance");
const uvBoundsLayout = tgpu.vertexLayout(d.disarrayOf(d.float32x4), "instance");
const colorLayout = tgpu.vertexLayout(d.disarrayOf(d.float32x4), "instance");
const pageLayout = tgpu.vertexLayout(d.disarrayOf(d.float32x4), "instance");

/**
 * The atlas, its view and its sampler, built together so their types are
 * inferred rather than widened. A `TgpuTexture` annotation here would broaden
 * the view to the sampled/storage union and the bind group would reject it.
 */
function createAtlas(root: TgpuRoot, texture: PortableLeafResource, pixelRange: number) {
  if (texture.kind !== "texture" && texture.kind !== "texture-array") {
    throw new TypeError("oblik expects an MSDF atlas texture");
  }
  const layers = texture.kind === "texture-array" ? texture.layers : 1;
  const atlas = root
    .createTexture({ size: [texture.width, texture.height, layers], format: texture.format })
    .$usage("sampled");
  try {
    atlas.write(texture.bytes);
  } catch (error) {
    atlas.destroy();
    throw error;
  }
  return {
    atlas,
    view: atlas.createView(d.texture2dArray(d.f32)),
    sampler: root.createSampler({ minFilter: "linear", magFilter: "linear" }),
    // What the fragment needs to turn a texel value into a distance in px: how
    // big the atlas is, and how many plane units the field's full range spans.
    info: root.createUniform(d.vec4f, [texture.width, texture.height, pixelRange, 0]),
  };
}

/** One `f32` out of a single-value raster constant buffer. */
function scalar(payload: PortableLeafResource | undefined, index = 0): number {
  if (payload === undefined || payload.kind !== "buffer") {
    throw new TypeError("oblik expects a raster constant buffer");
  }
  return new DataView(payload.bytes.buffer, payload.bytes.byteOffset, payload.bytes.byteLength).getFloat32(
    index * 4,
    true,
  );
}

type OblikAtlas = ReturnType<typeof createAtlas>;

export type OblikResourceOptions = {
  readonly root: TgpuRoot;
  readonly format: GPUTextureFormat;
  readonly sampleCount: number;
  readonly depthStencil?: GPUDepthStencilState | undefined;
};

/**
 * The atlas, the sampler, and the **two** pipelines a glyph quad draws through:
 * the knockout band, then the ink. See `fragment.ts` for why they are separate.
 */
export class OblikResource implements OblikResolvedResource {
  readonly #root: TgpuRoot;
  readonly #atlas: OblikAtlas["atlas"];
  readonly #view: OblikAtlas["view"];
  readonly #sampler: OblikAtlas["sampler"];
  readonly #info: OblikAtlas["info"];
  readonly #band: TgpuRenderPipeline;
  readonly #fill: TgpuRenderPipeline;

  constructor(options: OblikResourceOptions, payload: PortableResource) {
    if (payload.kind !== "group") {
      throw new TypeError("oblik expects grouped MSDF raster resources");
    }
    const texture = payload.members.texture;
    if (texture === undefined || (texture.kind !== "texture" && texture.kind !== "texture-array")) {
      throw new TypeError("oblik expects an MSDF atlas texture");
    }
    this.#root = options.root;
    const atlas = createAtlas(options.root, texture, scalar(payload.members.pixelRange));
    this.#atlas = atlas.atlas;
    this.#view = atlas.view;
    this.#sampler = atlas.sampler;
    this.#info = atlas.info;
    const pipeline = (fragment: typeof oblikBandFragment | typeof oblikFillFragment) =>
      options.root.createRenderPipeline({
        vertex: oblikVertex,
        fragment,
        attribs: {
          rect: rectLayout.attrib,
          uvRect: uvRectLayout.attrib,
          uvBounds: uvBoundsLayout.attrib,
          color: colorLayout.attrib,
          page: pageLayout.attrib,
        },
        targets: {
          format: options.format,
          // Straight alpha. Two draws with this blend, band then ink, compose
          // exactly as the single-quad version did — but across *all* glyphs,
          // which is the whole reason for the split.
          blend: {
            color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha" },
            alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
          },
        },
        multisample: { count: options.sampleCount },
        ...(options.depthStencil === undefined ? {} : { depthStencil: options.depthStencil }),
      });
    this.#band = pipeline(oblikBandFragment);
    this.#fill = pipeline(oblikFillFragment);
    // Compile now rather than inside the first draw: a shader error should
    // surface at font load, not as a label that never appears.
    this.#band.initSync();
    this.#fill.initSync();
  }

  prepare(
    buffers: ReadonlyMap<CodecBufferId, GPUBuffer>,
    frame: OblikFrame,
    transform: OblikTransform,
    start: number,
    count: number,
  ): OblikPreparedSpan {
    // One bind group per span: the atlas and the two frame uniforms are shared,
    // the three transform uniforms are this text's. The group is built once per
    // accepted display list — never per frame, because a camera move changes the
    // camera uniform's *contents*, not the group that references it.
    const group = this.#root.createBindGroup(oblikLayout, {
      camera: frame.camera,
      view: frame.view,
      atlasInfo: this.#info,
      label: transform.label,
      ring: transform.ring,
      ringColor: transform.ringColor,
      atlas: this.#view,
      samp: this.#sampler,
    });
    const b = msdfSchema.buffers;
    // One bind group, two pipelines: they differ only in the fragment stage, so
    // the instance buffers and uniforms are bound once.
    const bound = (pipeline: TgpuRenderPipeline) =>
      pipeline
        .with(group)
        .with(rectLayout, buffers.get(b.rect.id)!)
        .with(uvRectLayout, buffers.get(b.uvRect.id)!)
        .with(uvBoundsLayout, buffers.get(b.uvBounds.id)!)
        .with(colorLayout, buffers.get(b.color.id)!)
        .with(pageLayout, buffers.get(b.page.id)!);
    return {
      band: preparedDraw(this.#root, bound(this.#band), start, count),
      fill: preparedDraw(this.#root, bound(this.#fill), start, count),
    };
  }

  dispose(): void {
    this.#atlas.destroy();
  }
}

function preparedDraw(
  root: TgpuRoot,
  pipeline: TgpuRenderPipeline,
  start: number,
  count: number,
): OblikDraw {
  return {
    draw(pass, bindGroups) {
      let bound = pipeline;
      for (const group of bindGroups) bound = bound.with(group);
      bound.with("resourceType" in pass ? root.unwrap(pass) : pass).draw(6, count, 0, start);
    },
  };
}

/** Where the engine's buffer mutations are staged before a frame is accepted. */
interface RetainedBuffer {
  readonly bytes: Uint8Array;
  readonly gpu: GPUBuffer;
}

type BufferMutation =
  | { readonly kind: "write"; readonly target: RetainedBuffer; readonly offset: number; readonly payload: Uint8Array }
  | {
      readonly kind: "fill";
      readonly target: RetainedBuffer;
      readonly offset: number;
      readonly length: number;
      readonly value: number;
    }
  | {
      readonly kind: "copy";
      readonly target: RetainedBuffer;
      readonly offset: number;
      readonly source: RetainedBuffer;
      readonly sourceOffset: number;
      readonly length: number;
    };

interface Span {
  readonly resource: OblikResolvedResource;
  readonly buffers: readonly OblikBufferBinding[];
  readonly transform: OblikTransform;
  readonly start: number;
  readonly count: number;
}

export class OblikRenderer implements GlyphRenderer<OblikBindings, void> {
  readonly #root: TgpuRoot;
  readonly #frame: OblikFrame;
  #buffers = new Map<OblikBufferBinding, RetainedBuffer>();
  #spans: readonly Span[] = [];
  /**
   * One entry per span, each holding the band and the fill draw for it. Kept
   * together because they share a bind group and are rebuilt or reused as a
   * unit; recorded in two ordered sweeps by `draw`.
   */
  #prepared: readonly OblikPreparedSpan[] = [];
  #disposed = false;

  constructor(root: TgpuRoot) {
    this.#root = root;
    this.#frame = {
      camera: root.createUniform(d.mat4x4f),
      view: root.createUniform(d.vec4f),
    };
    this.#frame.view.write([0, 0, 0, 0]);
  }

  /** The per-frame uniforms the resource binds. A camera move writes `camera`. */
  get frame(): OblikFrame {
    return this.#frame;
  }

  /** Point the camera at a world→clip matrix. No label is touched. */
  setCamera(m: readonly number[]): void {
    this.#frame.camera.write(m);
  }

  draw(
    pass: TgpuRenderPass | GPURenderPassEncoder,
    width: number,
    height: number,
    bindGroups: readonly TgpuBindGroup[],
  ): void {
    if (this.#disposed) throw new Error("oblik renderer is disposed");
    if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
      throw new RangeError("oblik viewport width and height must be positive and finite");
    }
    // One screen pixel in clip space. This is the *only* thing the viewport
    // changes, and it carries no camera, which is what keeps text screen-sized.
    this.#frame.view.write([2 / width, 2 / height, 0, 0]);
    // **Every band, then every fill.** This is what stops one glyph's knockout
    // from erasing another's ink: kerning overlaps the boxes, and a ring drawn
    // with its own glyph would paint over the neighbour that came before it.
    for (const prepared of this.#prepared) prepared.band.draw(pass, bindGroups);
    for (const prepared of this.#prepared) prepared.fill.draw(pass, bindGroups);
  }

  decode(frame: CommandBufferView<OblikBindings>): PreparedRendererCommit<void> {
    const buffers = new Map(this.#buffers);
    const allocated: GPUBuffer[] = [];
    const mutations: BufferMutation[] = [];
    const dirty = new Set<RetainedBuffer>();
    try {
      for (const update of frame.updates.buffers) {
        const previous = buffers.get(update.buffer);
        if (previous?.bytes.byteLength === update.byteLength) continue;
        const next = new Uint8Array(update.byteLength);
        if (previous !== undefined) next.set(previous.bytes.subarray(0, next.length));
        const gpu = this.#root.device.createBuffer({
          size: Math.max(4, next.byteLength),
          usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });
        allocated.push(gpu);
        const target: RetainedBuffer = { bytes: next, gpu };
        buffers.set(update.buffer, target);
        dirty.add(target);
      }
      for (const patch of frame.updates.patches) {
        switch (patch.kind) {
          case "write": {
            const target = buffers.get(patch.buffer)!;
            mutations.push({
              kind: "write",
              target,
              offset: patch.destinationOffset,
              payload: patch.payload.slice(),
            });
            dirty.add(target);
            break;
          }
          case "fill": {
            const target = buffers.get(patch.buffer)!;
            mutations.push({
              kind: "fill",
              target,
              offset: patch.destinationOffset,
              length: patch.byteLength,
              value: patch.value,
            });
            dirty.add(target);
            break;
          }
          case "copy": {
            const target = buffers.get(patch.destination)!;
            mutations.push({
              kind: "copy",
              target,
              offset: patch.destinationOffset,
              source: buffers.get(patch.source)!,
              sourceOffset: patch.sourceOffset,
              length: patch.byteLength,
            });
            dirty.add(target);
            break;
          }
          case "allocate-or-resize":
          case "retire":
            // `updates.buffers` already sized the storage; the patches that
            // follow write into it.
            break;
        }
      }
      for (const retirement of frame.updates.retirements) {
        if (retirement.kind === "buffer") buffers.delete(retirement.buffer);
      }

      let spans = this.#spans;
      if (frame.displayList.kind === "replace") {
        const next: Span[] = [];
        for (const child of frame.displayList.value.children) {
          // The direct Codec emits one root instance per Text, never a batch.
          if (child.kind !== "instance") throw new Error("oblik expects the direct Codec to emit instances");
          const input = child.value.input;
          const primitive = input.instance.value.input;
          if (primitive.recordCount === 0) continue;
          next.push({
            resource: primitive.resource!,
            buffers: Array.from(input.buffers),
            transform: child.transform!,
            start: primitive.recordIndex,
            count: primitive.recordCount,
          });
        }
        spans = next;
      }

      // Reuse the previous draw whenever its inputs are identical: a draw holds
      // a bind group, and rebuilding one per frame would be the allocation the
      // whole design exists to avoid.
      const draws =
        spans === this.#spans && allocated.length === 0
          ? this.#prepared
          : spans.map((span, index) => {
              const previous = this.#spans[index];
              if (
                previous !== undefined &&
                span.resource === previous.resource &&
                span.transform === previous.transform &&
                span.start === previous.start &&
                span.count === previous.count &&
                span.buffers.length === previous.buffers.length &&
                span.buffers.every(
                  (binding, bufferIndex) =>
                    binding === previous.buffers[bufferIndex] &&
                    buffers.get(binding) === this.#buffers.get(binding),
                )
              ) {
                return this.#prepared[index]!;
              }
              const named = new Map<CodecBufferId, GPUBuffer>();
              for (const binding of span.buffers) {
                if (binding.input.declaration.kind === "codec") {
                  named.set(binding.input.declaration.value.id, buffers.get(binding)!.gpu);
                }
              }
              return span.resource.prepare(named, this.#frame, span.transform, span.start, span.count);
            });

      let active = true;
      return {
        result: undefined,
        commit: () => {
          if (!active) return;
          active = false;
          // Mutate the retained copy only once the frame is accepted.
          for (const mutation of mutations) commitMutation(mutation);
          for (const target of dirty) {
            this.#root.device.queue.writeBuffer(target.gpu, 0, target.bytes);
          }
          for (const [key, previous] of this.#buffers) {
            if (buffers.get(key) !== previous) previous.gpu.destroy();
          }
          this.#buffers = buffers;
          this.#spans = spans;
          this.#prepared = draws;
        },
        discard: () => {
          if (!active) return;
          active = false;
          for (const gpu of allocated) gpu.destroy();
        },
      };
    } catch (error) {
      for (const gpu of allocated) gpu.destroy();
      throw error;
    }
  }

  syncTransforms(): void {
    // Transforms are uniforms this renderer owns and writes directly; there is
    // nothing for the engine's transform table to synchronize.
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const value of this.#buffers.values()) value.gpu.destroy();
    this.#buffers.clear();
    this.#spans = [];
    this.#prepared = [];
    this.#frame.camera.buffer.destroy();
    this.#frame.view.buffer.destroy();
  }
}

function commitMutation(mutation: BufferMutation): void {
  const destination = mutation.target.bytes;
  if (mutation.kind === "write") {
    destination.set(mutation.payload, mutation.offset);
  } else if (mutation.kind === "fill") {
    const view = new DataView(
      destination.buffer,
      destination.byteOffset + mutation.offset,
      mutation.length,
    );
    for (let offset = 0; offset < mutation.length; offset += 4) {
      view.setUint32(offset, mutation.value, true);
    }
  } else if (mutation.target === mutation.source) {
    destination.copyWithin(mutation.offset, mutation.sourceOffset, mutation.sourceOffset + mutation.length);
  } else {
    destination.set(
      mutation.source.bytes.subarray(mutation.sourceOffset, mutation.sourceOffset + mutation.length),
      mutation.offset,
    );
  }
}
