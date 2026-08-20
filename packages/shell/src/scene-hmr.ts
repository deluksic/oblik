type SceneHotCb = (path: string, mod: Record<string, unknown>) => void;
const listeners = new Set<SceneHotCb>();

export function subscribeSceneHot(cb: SceneHotCb): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/**
 * Vite-injected `hot.accept(scenePaths, …)` calls this with the freshly
 * fetched modules. `mods[i]` is defined only for the file that changed.
 * Do not re-`import()` the glob URL here — that hits the ESM cache and
 * returns the previous `scene()`.
 */
export function applyHotScenes(
  keys: string[],
  mods: ReadonlyArray<Record<string, unknown> | undefined>,
): void {
  for (let i = 0; i < keys.length; i++) {
    const mod = mods[i];
    const key = keys[i];
    if (!mod || !key) continue;
    for (const cb of listeners) cb(key, mod);
  }
}
