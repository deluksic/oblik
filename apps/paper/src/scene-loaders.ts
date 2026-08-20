export const sceneLoaders = import.meta.glob("./scenes/*.ts");

type SceneHotCb = (path: string, mod: Record<string, unknown>) => void;
const listeners = new Set<SceneHotCb>();

export function subscribeSceneHot(cb: SceneHotCb): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

if (import.meta.hot) {
  import.meta.hot.on("vite:afterUpdate", ({ updates }) => {
    for (const u of updates) {
      const m = u.path.match(/\/scenes\/([^/?#]+)/);
      if (!m?.[1] || !m[1].endsWith(".ts")) continue;
      const key = `./scenes/${m[1]}`;
      const loader = sceneLoaders[key];
      if (!loader) continue;
      void loader().then((mod) => {
        if (!mod) return;
        for (const cb of listeners) {
          cb(key, mod as Record<string, unknown>);
        }
      });
    }
  });
}
