import type { SceneLoaderMap } from "./Host";

/**
 * Loader values are functions, so a loader map can't be content-deduped with
 * JSON.stringify (function values are dropped, making every map serialize to
 * "{}"). Its identity is the key set: scene content edits propagate through
 * the loaders module's own accepts, never through setLoaders.
 */
export function sceneLoaderKeys(m: SceneLoaderMap): string {
  return Object.keys(m).toSorted().join("\n");
}
