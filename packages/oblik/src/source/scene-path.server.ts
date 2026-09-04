import fs from "node:fs";
import path from "node:path";

export function resolveSceneFileAbs(workspaceRoot: string, sceneDir: string, rel: string): string {
  const key = rel.replace(/^\/+/, "").replace(/\?.*$/, "");
  const appRoot = path.resolve(sceneDir, "..", "..");
  const candidates = [safeResolveUnder(workspaceRoot, key), safeResolveUnder(appRoot, key)];
  for (const abs of candidates) {
    if (abs && fs.existsSync(abs)) return abs;
  }

  // Bare catalog id (`shelf.ts`) — not a same-basename helper such as `src/layout/foo.ts`.
  if (!key.includes("/")) {
    const inSceneDir = path.join(sceneDir, key);
    if (fs.existsSync(inSceneDir)) return inSceneDir;
  }

  throw new Error(`ENOENT: no such file or directory, open '${path.resolve(workspaceRoot, key)}'`);
}

function safeResolveUnder(root: string, rel: string): string | undefined {
  try {
    return resolveUnder(root, rel);
  } catch {
    return undefined;
  }
}

function resolveUnder(root: string, rel: string): string {
  const abs = path.resolve(root, path.normalize(rel));
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  if (abs !== root && !abs.startsWith(prefix)) throw new Error("path escapes sandbox");
  return abs;
}
