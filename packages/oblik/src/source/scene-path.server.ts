import fs from "node:fs";
import path from "node:path";

import { sceneBaseName } from "./scene-path";

export function resolveSceneFileAbs(
  workspaceRoot: string,
  sceneDir: string,
  rel: string,
): string {
  const key = rel.replace(/^\/+/, "").replace(/\?.*$/, "");
  const direct = safeResolveUnder(workspaceRoot, key);
  if (direct && fs.existsSync(direct)) return direct;

  const inSceneDir = path.join(sceneDir, sceneBaseName(key));
  if (fs.existsSync(inSceneDir)) return inSceneDir;

  throw new Error(`ENOENT: no such file or directory, open '${path.resolve(workspaceRoot, key)}'`);
}

function safeResolveUnder(root: string, rel: string): string | null {
  try {
    return resolveUnder(root, rel);
  } catch {
    return null;
  }
}

function resolveUnder(root: string, rel: string): string {
  const abs = path.resolve(root, path.normalize(rel));
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  if (abs !== root && !abs.startsWith(prefix)) throw new Error("path escapes sandbox");
  return abs;
}
