import fs from "node:fs";
import path from "node:path";

/** User TypeScript under the demo app — not loaders, dts, or node_modules. */
export function isUserAppSource(appRoot: string, file: string): boolean {
  const abs = path.resolve(file).replace(/\\/g, "/");
  const root = path.resolve(appRoot).replace(/\\/g, "/");
  if (abs !== root && !abs.startsWith(`${root}/`)) return false;
  if (!abs.endsWith(".ts") || abs.endsWith(".d.ts")) return false;
  if (abs.includes("/node_modules/")) return false;
  if (path.basename(abs) === "scene-loaders.ts") return false;
  return true;
}

export function listUserAppSources(appRoot: string): string[] {
  const src = path.join(appRoot, "src");
  const out: string[] = [];
  walkTs(src, out);
  return out.toSorted();
}

function walkTs(dir: string, out: string[]): void {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    const abs = path.join(dir, name);
    let st: fs.Stats;
    try {
      st = fs.statSync(abs);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (name === "node_modules") continue;
      walkTs(abs, out);
      continue;
    }
    if (name.endsWith(".ts") && !name.endsWith(".d.ts") && name !== "scene-loaders.ts") out.push(abs);
  }
}

/** Vite import specifiers relative to `appRoot/src` (where scene-loaders.ts lives). */
export function appSrcImportKey(appRoot: string, abs: string): string {
  const rel = path.relative(path.join(appRoot, "src"), abs).replace(/\\/g, "/");
  return `./${rel}`;
}
