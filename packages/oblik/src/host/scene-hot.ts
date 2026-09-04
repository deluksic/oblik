import type { Scene } from "../eval/scene";

export type SceneHotHandler = {
  onHot: (key: string, scene: Scene) => void;
};

let handler: SceneHotHandler | undefined = undefined;

export function registerSceneHot(next: SceneHotHandler | undefined): void {
  handler = next;
}

/** Vite-injected `hot.accept` delivers freshly fetched modules; cache every update by glob key. */
export function applyHotScenes(keys: string[], mods: unknown): void {
  const h = handler;
  if (!h) return;
  const list = Array.isArray(mods) ? mods : [mods];
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const mod = list[i] as { default?: Scene } | undefined;
    if (!key || !mod?.default) continue;
    h.onHot(key, mod.default);
  }
}
