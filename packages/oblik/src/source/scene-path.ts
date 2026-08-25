export function sceneBaseName(file: string): string {
  const key = file.replace(/^\/+/, "").replace(/\?.*$/, "");
  return key.split("/").pop() ?? key;
}

/** Map Vite app-relative scene paths onto the catalog module path. */
export function normalizeSceneRelPath(file: string, module?: string): string {
  const f = file.replace(/^\/+/, "").replace(/\?.*$/, "");
  const m = module?.replace(/^\/+/, "").replace(/\?.*$/, "");
  if (!m) return f;
  if (f === m) return m;
  if (sceneBaseName(f) === sceneBaseName(m)) return m;
  return f;
}
