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

export function scanOblikCatalog(sceneDir: string, workspaceRoot: string): OblikSceneEntry[] {
  const entries = listSceneFiles(sceneDir).map((abs) => {
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
  return listSceneFiles(sceneDir).map((abs) => sceneLoaderKey(path.basename(abs)));
}

export function sceneLoadersAcceptTail(keys: string[]): string {
  const lit = JSON.stringify(keys);
  return `
/* __oblik_scene_hmr */
import { applyHotScenes } from "oblik/host";
if (import.meta.hot) import.meta.hot.accept(${lit}, (mods) => { if (mods) applyHotScenes(${lit}, mods); });
`;
}
