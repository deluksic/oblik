export function sceneBaseName(file: string): string {
  const key = file.replace(/^\/+/, "").replace(/\?.*$/, "");
  return key.split("/").pop() ?? key;
}

/** Map Vite app-relative paths onto the repo path for the same file. */
export function normalizeSceneRelPath(file: string, module?: string): string {
  const f = file.replace(/^\/+/, "").replace(/\?.*$/, "");
  const m = module?.replace(/^\/+/, "").replace(/\?.*$/, "");
  if (!m) return f;
  if (f === m) return m;
  if (m.endsWith(`/${f}`) || f.endsWith(`/${m}`)) return m.length >= f.length ? m : f;
  return f;
}
