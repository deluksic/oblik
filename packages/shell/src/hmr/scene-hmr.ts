type SceneHotCb = (path: string, mod: Record<string, unknown>) => void;
const listeners = new Set<SceneHotCb>();

export const SCENE_HELPER_HMR_EVENT = "scene-helper:update";

type HelperHotCb = () => void;
const helperListeners = new Set<HelperHotCb>();

export function subscribeSceneHot(cb: SceneHotCb): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Layout helpers (`scenes/*.ts` but not `*.scene.ts`) changed — re-run open panes. */
export function subscribeHelperHot(cb: HelperHotCb): () => void {
  helperListeners.add(cb);
  return () => {
    helperListeners.delete(cb);
  };
}

/** Called from scene-loaders after a helper module hot-updates (deferred one tick). */
export function notifyHelperHot(): void {
  queueMicrotask(() => {
    for (const cb of helperListeners) cb();
  });
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
