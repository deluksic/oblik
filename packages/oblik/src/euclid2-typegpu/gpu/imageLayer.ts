import type { TgpuBuffer, TgpuRoot, UniformFlag } from "typegpu";
import { arrayOf } from "typegpu/data";

import { createImageCache, type ImageView } from "./imageCache";
import { imageLayout } from "./layout";
import { createImagePipelines, IMAGE_QUAD_VERTICES, type ImagePipelines } from "./pipelines/images";
import { Frame, ImageInst, MAX_IMAGES, type ImageInstValue } from "./schemas";

/** The painter's frame uniform. `Frame` is the schema, not the JS value type:
 * a buffer is typed by what it was created from. */
type FrameBuffer = TgpuBuffer<typeof Frame> & UniformFlag;

/** What the adapter hands the layer: one slot of the instance array, and the
 * source whose texture draws it. */
export type ImageDraw = { slot: number; src: string };

export type ImageLayer = {
  /** Byte-diffed instance writes, then this tick's draw list. */
  sync(writes: { idx: number; value: ImageInstValue }[], draws: readonly ImageDraw[]): void;
  /** Draw every reference, in tape order, before the grid. */
  draw(pass: GPURenderPassEncoder): void;
  destroy(): void;
};

/**
 * The reference layer: the quads, and the textures they sample.
 *
 * It draws first in the single existing pass — under the grid, the fills, the
 * strokes and the points — so a reference is a backdrop to trace over rather
 * than a thing the sketch collides with. A source owns a pipeline because the
 * bind group is a creation-time constant here, the same way the grid bakes its
 * colour; the set is bounded by how many references a scene holds, and a
 * pipeline is rebuilt only when its texture actually arrives.
 */
export function createImageLayer(opts: {
  root: TgpuRoot;
  format: GPUTextureFormat;
  /** The painter's frame uniform, bound into every image bind group. */
  frameBuffer: FrameBuffer;
  onReady: () => void;
}): ImageLayer {
  const { root, format, frameBuffer, onReady } = opts;
  const imageBuffer = root.createBuffer(arrayOf(ImageInst, MAX_IMAGES)).$usage("storage");
  const cache = createImageCache({ root, onReady });

  /** One bound pipeline per source. The view it was built for is what says
   * whether it is still current: a texture arriving changes the view. */
  const bound = new Map<string, { view: ImageView; pipelines: ImagePipelines }>();
  let draws: readonly ImageDraw[] = [];

  function pipelinesFor(src: string): ImagePipelines {
    const view = cache.view(src);
    const hit = bound.get(src);
    if (hit && hit.view === view) return hit.pipelines;
    hit?.pipelines.destroy();
    const group = root.createBindGroup(imageLayout, {
      frame: frameBuffer,
      images: imageBuffer,
      tex: view,
      samp: cache.sampler,
    });
    const pipelines = createImagePipelines(root, group, format);
    bound.set(src, { view, pipelines });
    return pipelines;
  }

  return {
    sync(writes, next) {
      imageBuffer.writePartial(writes);
      draws = next;
      const live = new Set(next.map((d) => d.src));
      cache.release(live);
      for (const [src, entry] of bound) {
        if (live.has(src)) continue;
        entry.pipelines.destroy();
        bound.delete(src);
      }
    },
    draw(pass) {
      for (const draw of draws) {
        pipelinesFor(draw.src).image(pass).draw(IMAGE_QUAD_VERTICES, 1, 0, draw.slot);
      }
    },
    destroy() {
      for (const entry of bound.values()) entry.pipelines.destroy();
      bound.clear();
      cache.destroy();
      imageBuffer.destroy();
    },
  };
}
