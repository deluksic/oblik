export const sceneLoaders = import.meta.glob("./scenes/*.ts");

type SceneHotCb = (path: string, mod: Record<string, unknown>) => void;
const listeners = new Set<SceneHotCb>();

export function subscribeSceneHot(cb: SceneHotCb): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function sceneKeyFromUrl(url: string): string | null {
  const m = url.match(/\/scenes\/([^/?#]+)/);
  if (!m?.[1] || !m[1].endsWith(".ts")) return null;
  return `./scenes/${m[1]}`;
}

if (import.meta.hot) {
  import.meta.hot.on("vite:afterUpdate", ({ updates }) => {
    const keys = new Set<string>();
    for (const u of updates) {
      for (const url of [u.path, u.acceptedPath]) {
        const key = sceneKeyFromUrl(url);
        if (key) keys.add(key);
      }
    }
    for (const key of keys) {
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
