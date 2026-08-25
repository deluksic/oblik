import type { Scene } from "../eval/scene";

export type SceneHotHandler = {
  currentPath: () => string;
  onHot: (scene: Scene) => void;
};

let handler: SceneHotHandler | null = null;

export function registerSceneHot(next: SceneHotHandler): void {
  handler = next;
}

export function applyHotScenes(keys: string[], mods: unknown): void {
  const h = handler;
  if (!h) return;
  const path = h.currentPath();
  const base = path.split("/").pop() ?? "";
  const idx = keys.findIndex((k) => k.endsWith(`/${base}`) || k === `./scenes/${base}`);
  if (idx < 0) return;
  const list = Array.isArray(mods) ? mods : [mods];
  const mod = list[idx] as { default?: Scene } | undefined;
  if (mod?.default) h.onHot(mod.default);
}
