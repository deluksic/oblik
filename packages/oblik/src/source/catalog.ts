import fs from "node:fs";
import path from "node:path";

import * as ts from "typescript";

import { listAnnotationSites, type Annotation } from "./analyze";
import { analyzeMentions, type MentionFile } from "./mention";

export type OblikSceneEntry = {
  /** Scene-relative posix path without extension (e.g. `layout/tree`) — unique per file, URL-safe when encoded. */
  id: string;
  /** Scene-relative posix path with extension (e.g. `layout/tree.ts`) — the loader-key tail. */
  file: string;
  path: string;
  /** Authored `defineScene` title; undefined when the scene doesn't declare one. */
  title?: string;
  kind: "euclid2" | "figure";
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

export function parseOblikSceneSource(
  source: string,
  relPath: string,
  sceneRel: string,
): OblikSceneEntry {
  const file = sceneRel.replace(/\\/g, "/");
  const id = file.replace(/\.ts$/, "");
  const { title, kind } = parseDefineScene(source, file);

  if (!source.includes("defineScene")) {
    return {
      id,
      file,
      path: relPath.replace(/\\/g, "/"),
      title,
      kind: "euclid2",
      error: "no defineScene export",
    };
  }

  if (kind && kind !== "euclid2" && kind !== "figure") {
    return {
      id,
      file,
      path: relPath.replace(/\\/g, "/"),
      title,
      kind: "euclid2",
      error: `unsupported kind "${kind}"`,
    };
  }

  return {
    id,
    file,
    path: relPath.replace(/\\/g, "/"),
    title,
    kind: kind === "figure" ? "figure" : "euclid2",
  };
}

export function listSceneFiles(sceneDir: string): string[] {
  if (!fs.existsSync(sceneDir)) return [];
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.isDirectory()) walk(path.join(dir, ent.name));
      else if (ent.isFile() && ent.name.endsWith(".ts") && !ent.name.endsWith(".d.ts")) {
        out.push(path.join(dir, ent.name));
      }
    }
  };
  walk(sceneDir);
  return out.toSorted();
}

export function listCatalogFiles(sceneDir: string): string[] {
  return listSceneFiles(sceneDir).filter((abs) =>
    fs.readFileSync(abs, "utf8").includes("defineScene"),
  );
}

export function scanOblikCatalog(sceneDir: string, workspaceRoot: string): OblikSceneEntry[] {
  const entries = listCatalogFiles(sceneDir).map((abs) => {
    const rel = path.relative(workspaceRoot, abs);
    const sceneRel = path.relative(sceneDir, abs);
    return parseOblikSceneSource(fs.readFileSync(abs, "utf8"), rel, sceneRel);
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
  return listCatalogFiles(sceneDir).map((abs) =>
    sceneLoaderKey(path.relative(sceneDir, abs).replace(/\\/g, "/")),
  );
}

export function sceneLoadersAcceptTail(keys: string[]): string {
  const lit = JSON.stringify(keys);
  return `
/* __oblik_scene_hmr */
import { applyHotScenes } from "oblik/host";
if (import.meta.hot) import.meta.hot.accept(${lit}, (mods) => { if (mods) applyHotScenes(${lit}, mods); });
`;
}

/** Source of the `virtual:oblik-loaders` module — rescanned on every load so new scenes register without restart. */
export function sceneLoadersModule(keys: string[]): string {
  const entries = keys
    .map((key) => `  ${JSON.stringify(key)}: () => import(${JSON.stringify(key)}),`)
    .join("\n");
  return `export const sceneLoaders = {
${entries}
};
${sceneLoadersAcceptTail(keys)}
`;
}

export function mergeAnnotationBundle<T>(
  bundle: Record<string, Record<string, T>>,
): Record<string, T> {
  const out: Record<string, T> = {};
  for (const file of Object.values(bundle)) Object.assign(out, file);
  return out;
}

export type DuplicateIdSite = {
  file: string;
  line: number;
  column: number;
};

export type DuplicateId = {
  id: string;
  sites: DuplicateIdSite[];
};

/** Same trailing id on two constructor calls — invalid; ids are project-wide. */
export function findDuplicateIds(
  sites: readonly { id: string; file: string; line: number; column: number }[],
): DuplicateId[] {
  const groups = new Map<string, DuplicateIdSite[]>();
  for (const s of sites) {
    const list = groups.get(s.id) ?? [];
    list.push({ file: s.file, line: s.line, column: s.column });
    groups.set(s.id, list);
  }
  return [...groups.entries()]
    .filter(([, hits]) => hits.length > 1)
    .map(([id, hits]) => ({ id, sites: hits }))
    .toSorted((a, b) => a.id.localeCompare(b.id));
}

export function scanAnnotationsBundle(
  files: readonly string[],
  workspaceRoot: string,
): { byPath: Record<string, Record<string, Annotation>>; collisions: DuplicateId[] } {
  const byPath: Record<string, Record<string, Annotation>> = {};
  const all: Annotation[] = [];
  for (const abs of files) {
    const rel = path.relative(workspaceRoot, abs).replace(/\\/g, "/");
    const src = fs.readFileSync(abs, "utf8");
    const sites = listAnnotationSites(src, rel);
    all.push(...sites);
    byPath[rel] = Object.fromEntries(sites.map((s) => [s.id, s]));
  }
  return { byPath, collisions: findDuplicateIds(all) };
}

export function scanMentionsBundle(
  files: readonly string[],
  workspaceRoot: string,
): Record<string, MentionFile> {
  const byPath: Record<string, MentionFile> = {};
  for (const abs of files) {
    const rel = path.relative(workspaceRoot, abs).replace(/\\/g, "/");
    byPath[rel] = analyzeMentions(fs.readFileSync(abs, "utf8"), rel);
  }
  return byPath;
}
