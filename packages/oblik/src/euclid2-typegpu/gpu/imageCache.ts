import type { TgpuRoot, TgpuSampler, TgpuTexture, TgpuTextureView } from "typegpu";
import type { F32, WgslTexture2d } from "typegpu/data";

/** What the bind group's `tex` entry takes; named once so the cache and the
 * layer agree on it without either spelling out the schema twice. */
export type ImageView = TgpuTextureView<WgslTexture2d<F32>>;

/**
 * Reference bitmaps, loaded off the tape.
 *
 * `createImageBitmap` is the only format-specific code in the renderer — that is
 * what makes "any format the browser decodes" cheap at this end: the import flow
 * already proved the blob decodes, and everything past this point handles a
 * texture. Nothing here reaches eval: a reference is a URL and a rect, and the
 * pixels arrive whenever they arrive.
 *
 * A 1×1 transparent placeholder stands in until a source loads, and forever for
 * a source that never does, so a broken or missing URL draws nothing rather than
 * failing the frame. One load per source, never retried once it has settled, and
 * every texture is destroyed when its source leaves the scene.
 */

type Entry = {
  /** Bumped per load attempt, so a texture that arrives after a release (or
   * after a fresh request for the same source) is thrown away, not installed. */
  generation: number;
  state: "loading" | "ready" | "failed";
  texture?: TgpuTexture;
  view?: ImageView;
};

export type ImageCache = {
  /** Sampled view for `src`: the real texture once it is up, else the placeholder. */
  view(src: string): ImageView;
  /** Linear, clamp-to-edge: a reference is drawn at whatever size its rect says. */
  readonly sampler: TgpuSampler;
  /** Forget (and destroy) every texture whose source is not in `keep`. */
  release(keep: ReadonlySet<string>): void;
  destroy(): void;
};

export function createImageCache(opts: { root: TgpuRoot; onReady: () => void }): ImageCache {
  const { root, onReady } = opts;
  const sampler = root.createSampler({
    magFilter: "linear",
    minFilter: "linear",
    addressModeU: "clamp-to-edge",
    addressModeV: "clamp-to-edge",
  });

  const placeholder = root
    .createTexture({ size: [1, 1], format: "rgba8unorm" })
    .$usage("sampled", "render");
  placeholder.write(new Uint8Array([0, 0, 0, 0]));
  const placeholderView = placeholder.createView();

  const entries = new Map<string, Entry>();

  async function load(src: string, generation: number): Promise<void> {
    try {
      const response = await fetch(src);
      if (!response.ok) throw new Error(String(response.status));
      const bitmap = await createImageBitmap(await response.blob());
      const texture = root
        .createTexture({ size: [bitmap.width, bitmap.height], format: "rgba8unorm" })
        .$usage("sampled", "render");
      texture.write(bitmap);
      bitmap.close();
      const entry = entries.get(src);
      if (!entry || entry.generation !== generation) {
        texture.destroy();
        return;
      }
      entry.texture = texture;
      entry.view = texture.createView();
      entry.state = "ready";
      onReady();
    } catch {
      const entry = entries.get(src);
      // Undecodable or unreachable: the placeholder is already what was drawn.
      if (entry && entry.generation === generation) entry.state = "failed";
    }
  }

  return {
    sampler,
    view(src) {
      const entry = entries.get(src);
      if (entry?.state === "ready") return entry.view!;
      if (!entry) {
        const fresh: Entry = { generation: 1, state: "loading" };
        entries.set(src, fresh);
        void load(src, fresh.generation);
      }
      return placeholderView;
    },
    release(keep) {
      for (const [src, entry] of entries) {
        if (keep.has(src)) continue;
        entry.texture?.destroy();
        entries.delete(src);
      }
    },
    destroy() {
      for (const entry of entries.values()) entry.texture?.destroy();
      entries.clear();
      placeholder.destroy();
    },
  };
}
