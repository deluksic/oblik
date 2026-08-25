import fs from "node:fs";
import path from "node:path";

import * as ts from "typescript";

export type OblikSceneEntry = {
  id: string;
  file: string;
  path: string;
  title: string;
  kind: "euclid2";
  error?: string;
};

function parseDefineScene(source: string, file: string): { title?: string; kind?: string } {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let title: string | undefined;
  let kind: string | undefined;

  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "defineScene" &&
      node.arguments[0] &&
      ts.isObjectLiteralExpression(node.arguments[0])
    ) {
      for (const prop of node.arguments[0].properties) {
        if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) continue;
        if (prop.name.text === "title" && ts.isStringLiteral(prop.initializer)) {
          title = prop.initializer.text;
        }
        if (prop.name.text === "kind" && ts.isStringLiteral(prop.initializer)) {
          kind = prop.initializer.text;
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { title, kind };
}

export function parseOblikSceneSource(absPath: string, source: string, relPath: string): OblikSceneEntry {
  const file = path.basename(absPath);
  const id = path.basename(absPath, ".ts");
  const { title, kind } = parseDefineScene(source, file);

  if (!source.includes("defineScene")) {
    return {
      id,
      file,
      path: relPath.replace(/\\/g, "/"),
      title: title ?? id,
      kind: "euclid2",
      error: "no defineScene export",
    };
  }

  if (kind && kind !== "euclid2") {
    return {
      id,
      file,
      path: relPath.replace(/\\/g, "/"),
      title: title ?? id,
      kind: "euclid2",
      error: `unsupported kind "${kind}"`,
    };
  }

  return {
    id,
    file,
    path: relPath.replace(/\\/g, "/"),
    title: title ?? id,
    kind: "euclid2",
  };
}

export function listSceneFiles(sceneDir: string): string[] {
  if (!fs.existsSync(sceneDir)) return [];
  return fs
    .readdirSync(sceneDir)
    .filter((n) => n.endsWith(".ts") && !n.endsWith(".d.ts"))
    .map((n) => path.join(sceneDir, n))
    .toSorted();
}

export function listCatalogFiles(sceneDir: string): string[] {
  return listSceneFiles(sceneDir).filter((abs) => fs.readFileSync(abs, "utf8").includes("defineScene"));
}

export function scanOblikCatalog(sceneDir: string, workspaceRoot: string): OblikSceneEntry[] {
  const entries = listCatalogFiles(sceneDir).map((abs) => {
    const rel = path.relative(workspaceRoot, abs);
    return parseOblikSceneSource(abs, fs.readFileSync(abs, "utf8"), rel);
  });
  const seen = new Map<string, string>();
  for (const e of entries) {
    const prev = seen.get(e.id);
    if (prev) e.error = `duplicate id "${e.id}" (also ${prev})`;
    else seen.set(e.id, e.file);
  }
  return entries;
}

export function sceneLoaderKey(file: string): string {
  return `./scenes/${file}`;
}

export function sceneGlobKeys(sceneDir: string): string[] {
  return listCatalogFiles(sceneDir).map((abs) => sceneLoaderKey(path.basename(abs)));
}

export function sceneLoadersAcceptTail(keys: string[], helpers: string[] = []): string {
  const lit = JSON.stringify(keys);
  let snip = `
/* __oblik_scene_hmr */
import { applyHotScenes, notifyHelperHot } from "oblik/host";
if (import.meta.hot) import.meta.hot.accept(${lit}, (mods) => { if (mods) applyHotScenes(${lit}, mods); });
`;
  if (helpers.length > 0) {
    const helperLit = JSON.stringify(helpers);
    for (const h of helpers) snip += `import ${JSON.stringify(h)};\n`;
    snip += `if (import.meta.hot) import.meta.hot.accept(${helperLit}, () => { notifyHelperHot(); });\n`;
  }
  return snip;
}

/** Vite transform output for scene-loaders.ts — rescanned on every transform so new scenes register without restart. */
export function sceneLoadersModule(keys: string[], helpers: string[] = []): string {
  const entries = keys
    .map((key) => `  ${JSON.stringify(key)}: () => import(${JSON.stringify(key)}),`)
    .join("\n");
  return `export const sceneLoaders = {
${entries}
};
${sceneLoadersAcceptTail(keys, helpers)}
`;
}

export function mergeAnnotationBundle<T>(bundle: Record<string, Record<string, T>>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const file of Object.values(bundle)) Object.assign(out, file);
  return out;
}

export function scanAnnotationsBundle(
  files: readonly string[],
  workspaceRoot: string,
  analyze: (source: string, file: string) => Map<string, unknown>,
): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const abs of files) {
    const rel = path.relative(workspaceRoot, abs).replace(/\\/g, "/");
    const src = fs.readFileSync(abs, "utf8");
    out[rel] = Object.fromEntries(analyze(src, rel));
  }
  return out;
}
