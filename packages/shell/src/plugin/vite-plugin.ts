import fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";

import type { Plugin, ViteDevServer } from "vite";

import { parseSceneSource } from "../catalog/catalog.ts";
import { newSceneSource, titleFromId } from "../catalog/new-scene.ts";
import { injectSceneSites } from "../editor/inject-sites.ts";
import { applyScenePatch, type ScenePatch, type SourceAt } from "../editor/insert-editor.ts";
import { patchWidgetAt } from "../editor/patch-widget.ts";
import { SCENE_HELPER_HMR_EVENT } from "../hmr/scene-hmr.ts";
import { isSceneId } from "../layout/grid.ts";
import type { SceneEntry } from "../types.ts";

const VIRTUAL_CATALOG = "virtual:scene-catalog";
const VIRTUAL_CATALOG_RESOLVED = "\0virtual:scene-catalog";

export type SceneDevOptions = {
  /** Repo root — peek may read any file under here. */
  workspaceRoot: string;
  /** Directory that contains scene .ts files (write sandbox). */
  sceneDir: string;
};

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function resolveUnder(root: string, rel: string): string {
  const abs = path.resolve(root, path.normalize(rel));
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  if (abs !== root && !abs.startsWith(prefix)) {
    throw new Error("path escapes sandbox");
  }
  return abs;
}

function sendText(res: ServerResponse, text: string) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end(text);
}

function listSceneFiles(sceneDir: string): string[] {
  if (!fs.existsSync(sceneDir)) return [];
  return fs
    .readdirSync(sceneDir)
    .filter((n) => n.endsWith(".scene.ts"))
    .map((n) => path.join(sceneDir, n))
    .toSorted();
}

export function scanSceneCatalog(sceneDir: string): SceneEntry[] {
  const entries = listSceneFiles(sceneDir).map((abs) =>
    parseSceneSource(abs, fs.readFileSync(abs, "utf8")),
  );
  const seen = new Map<string, string>();
  for (const e of entries) {
    const prev = seen.get(e.id);
    if (prev) {
      e.error = `duplicate id "${e.id}" (also ${prev})`;
    } else {
      seen.set(e.id, e.file);
    }
  }
  return entries;
}

function invalidateCatalog(server: ViteDevServer): void {
  const mod = server.moduleGraph.getModuleById(VIRTUAL_CATALOG_RESOLVED);
  if (mod) void server.reloadModule(mod);
}

function invalidateSceneLoaders(server: ViteDevServer): void {
  for (const mod of server.moduleGraph.idToModuleMap.values()) {
    const file = mod.file?.replace(/\\/g, "/") ?? "";
    if (file.endsWith("/scene-loaders.ts")) void server.reloadModule(mod);
  }
}

function catalogFingerprint(sceneDir: string): string {
  return JSON.stringify(scanSceneCatalog(sceneDir));
}

function isCatalogScene(sceneDir: string, file: string): boolean {
  const abs = path.resolve(file).replace(/\\/g, "/");
  const dir = path.resolve(sceneDir).replace(/\\/g, "/");
  return abs.startsWith(dir + "/") && abs.endsWith(".scene.ts");
}

/** Shared layout helpers next to catalog scenes (e.g. plate-layout.ts). */
function isSceneHelper(sceneDir: string, file: string): boolean {
  const abs = path.resolve(file).replace(/\\/g, "/");
  const dir = path.resolve(sceneDir).replace(/\\/g, "/");
  return (
    abs.startsWith(dir + "/") &&
    abs.endsWith(".ts") &&
    !abs.endsWith(".scene.ts") &&
    !abs.endsWith(".d.ts")
  );
}

function workspaceRelPath(absFile: string, root: string): string {
  return path.relative(root, absFile).replace(/\\/g, "/");
}

function isInjectableTs(workspaceRoot: string, file: string): boolean {
  const abs = path.resolve(file).replace(/\\/g, "/");
  const root = path.resolve(workspaceRoot).replace(/\\/g, "/");
  if (!abs.startsWith(root + "/")) return false;
  if (!abs.endsWith(".ts") || abs.endsWith(".d.ts")) return false;
  if (abs.includes("/node_modules/")) return false;
  return true;
}

function isSceneLoadersModule(id: string): boolean {
  return path.basename(id.split("?")[0]) === "scene-loaders.ts";
}

function sceneGlobKeys(sceneDir: string): string[] {
  return listSceneFiles(sceneDir).map((abs) => `./scenes/${path.basename(abs)}`);
}

function helperGlobKeys(sceneDir: string): string[] {
  if (!fs.existsSync(sceneDir)) return [];
  return fs
    .readdirSync(sceneDir)
    .filter((n) => n.endsWith(".ts") && !n.endsWith(".scene.ts"))
    .map((n) => `./scenes/${n}`)
    .toSorted();
}

/**
 * Appended onto scene-loaders.ts. Vite rewrites the first array to absolute
 * HMR URLs; the copy passed to applyHotScenes stays as glob keys so hosts
 * can match `./scenes/<file>`. Indices stay aligned.
 */
export function sceneLoadersAcceptTail(keys: string[], helpers: string[] = []): string {
  const sceneLit = JSON.stringify(keys);
  const helperLit = JSON.stringify(helpers);
  let snip = `\n/* __scene_hmr_accept */\n`;
  snip += `import { applyHotScenes, notifyHelperHot } from "@design-scenes/shell";\n`;
  for (const h of helpers) {
    snip += `import ${JSON.stringify(h)};\n`;
  }
  snip += `if (import.meta.hot) import.meta.hot.accept(${sceneLit}, (mods) => { if (mods) applyHotScenes(${sceneLit}, mods); });\n`;
  if (helpers.length > 0) {
    snip += `if (import.meta.hot) import.meta.hot.accept(${helperLit}, () => { notifyHelperHot(); });\n`;
    snip += `if (import.meta.hot) import.meta.hot.on(${JSON.stringify(SCENE_HELPER_HMR_EVENT)}, () => { notifyHelperHot(); });\n`;
  }
  return snip;
}

function hotReloadSceneFile(server: ViteDevServer, abs: string): void {
  const mods = server.moduleGraph.getModulesByFile(abs);
  if (!mods) return;
  for (const mod of mods) void server.reloadModule(mod);
}

function fileAliases(file: string): string[] {
  const abs = path.resolve(file);
  const posix = abs.replace(/\\/g, "/");
  return [...new Set([abs, posix, path.basename(abs)])];
}

function rememberWidgetWrite(writes: Map<string, string>, file: string, content: string): void {
  for (const key of fileAliases(file)) writes.set(key, content);
}

function rememberedWrite(writes: Map<string, string>, file: string): string | undefined {
  for (const key of fileAliases(file)) {
    const content = writes.get(key);
    if (content != null) return content;
  }
  return undefined;
}

function parseSourceAt(raw: unknown): SourceAt | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.line !== "number" || typeof o.column !== "number") return null;
  return { line: o.line, column: o.column };
}

function parseScenePatch(raw: Record<string, unknown>): ScenePatch | string {
  const patch: ScenePatch = {};
  if (raw.hoistAt !== undefined) {
    if (!Array.isArray(raw.hoistAt)) return "hoistAt must be an array";
    const hoistAt: SourceAt[] = [];
    for (const item of raw.hoistAt) {
      const at = parseSourceAt(item);
      if (!at) return "invalid hoistAt entry";
      hoistAt.push(at);
    }
    patch.hoistAt = hoistAt;
  }
  if (raw.imports !== undefined) {
    if (!raw.imports || typeof raw.imports !== "object" || Array.isArray(raw.imports)) {
      return "imports must be an object";
    }
    const imports: Record<string, string[]> = {};
    for (const [mod, names] of Object.entries(raw.imports as Record<string, unknown>)) {
      if (!Array.isArray(names) || names.some((n) => typeof n !== "string")) {
        return "imports values must be string arrays";
      }
      imports[mod] = names as string[];
    }
    patch.imports = imports;
  }
  if (raw.statements !== undefined) {
    if (!Array.isArray(raw.statements) || raw.statements.some((s) => typeof s !== "string")) {
      return "statements must be a string array";
    }
    patch.statements = raw.statements as string[];
  }
  if (raw.exprs !== undefined) {
    if (!Array.isArray(raw.exprs) || raw.exprs.some((s) => typeof s !== "string")) {
      return "exprs must be a string array";
    }
    patch.exprs = raw.exprs as string[];
  }
  return patch;
}

export function sceneDevPlugin(opts: SceneDevOptions): Plugin {
  const workspaceRoot = path.resolve(opts.workspaceRoot);
  const sceneDir = path.resolve(opts.sceneDir);
  let vite: ViteDevServer | undefined;
  let lastCatalog = "";
  const widgetWrites = new Map<string, string>();

  function catalogChanged(): boolean {
    const next = catalogFingerprint(sceneDir);
    if (next === lastCatalog) return false;
    lastCatalog = next;
    return true;
  }

  return {
    name: "scene-dev",
    // Before Vite/oxc TS: `at` must be disk line/column, not post-transpile.
    enforce: "pre",
    resolveId(id) {
      if (id === VIRTUAL_CATALOG) return VIRTUAL_CATALOG_RESOLVED;
      return undefined;
    },
    load(id) {
      if (id !== VIRTUAL_CATALOG_RESOLVED) return undefined;
      const scenes = scanSceneCatalog(sceneDir);
      lastCatalog = JSON.stringify(scenes);
      return `export const scenes = ${JSON.stringify(scenes)};\n`;
    },
    configureServer(server) {
      vite = server;
      server.watcher.add(sceneDir);
      const onSceneTree = (file: string) => {
        if (!isCatalogScene(sceneDir, file)) return;
        if (catalogChanged()) invalidateCatalog(server);
      };
      server.watcher.on("add", onSceneTree);
      server.watcher.on("unlink", onSceneTree);

      server.middlewares.use((req, res, next) => {
        void (async () => {
          const url = req.url?.split("?")[0] ?? "";
          try {
            if (url === "/__write-widget" && req.method === "POST") {
              const raw = JSON.parse(await readBody(req)) as Record<string, unknown>;
              const file = raw.file;
              const values = raw.values;
              const line = raw.line;
              const column = raw.column;

              if (
                typeof file !== "string" ||
                typeof line !== "number" ||
                typeof column !== "number" ||
                !Array.isArray(values) ||
                !values.every((v) => typeof v === "number")
              ) {
                json(res, 400, {
                  ok: false,
                  error: `invalid body: expected { file, line, column, values }; got keys [${Object.keys(raw).join(", ")}]`,
                });
                return;
              }

              const abs = resolveUnder(workspaceRoot, file);
              if (!abs.endsWith(".ts") || abs.endsWith(".d.ts")) {
                json(res, 400, { ok: false, error: "expected a .ts file path" });
                return;
              }
              const source = fs.readFileSync(abs, "utf8");
              const patched = patchWidgetAt(source, line, column, values);
              rememberWidgetWrite(widgetWrites, abs, patched);
              fs.writeFileSync(abs, patched);
              json(res, 200, { ok: true });
              return;
            }

            if (url === "/__insert-editor" && req.method === "POST") {
              const raw = JSON.parse(await readBody(req)) as Record<string, unknown>;
              const file = raw.file;
              if (typeof file !== "string") {
                json(res, 400, {
                  ok: false,
                  error: "expected { file, statements?, exprs?, imports?, hoistAt? }",
                });
                return;
              }
              const parsed = parseScenePatch(raw);
              if (typeof parsed === "string") {
                json(res, 400, { ok: false, error: parsed });
                return;
              }
              const abs = resolveUnder(sceneDir, path.basename(file));
              if (!abs.endsWith(".scene.ts")) {
                json(res, 400, {
                  ok: false,
                  error: "insert-editor only writes catalog .scene.ts files",
                });
                return;
              }
              const source = fs.readFileSync(abs, "utf8");
              try {
                fs.writeFileSync(abs, applyScenePatch(source, parsed));
              } catch (err) {
                json(res, 400, {
                  ok: false,
                  error: err instanceof Error ? err.message : String(err),
                });
                return;
              }
              for (const key of fileAliases(abs)) widgetWrites.delete(key);
              if (vite) hotReloadSceneFile(vite, abs);
              json(res, 200, { ok: true });
              return;
            }

            if (url === "/__create-scene" && req.method === "POST") {
              const raw = JSON.parse(await readBody(req)) as Record<string, unknown>;
              const id = raw.id;
              if (typeof id !== "string" || !isSceneId(id)) {
                json(res, 400, {
                  ok: false,
                  error: "id must match [a-z][a-z0-9-]* so it can be a CSS grid area",
                });
                return;
              }
              const abs = resolveUnder(sceneDir, `${id}.scene.ts`);
              if (fs.existsSync(abs)) {
                json(res, 409, {
                  ok: false,
                  error: `${id}.scene.ts already exists`,
                });
                return;
              }
              const title =
                typeof raw.title === "string" && raw.title.trim()
                  ? raw.title.trim()
                  : titleFromId(id);
              fs.writeFileSync(abs, newSceneSource(id, title));
              lastCatalog = "";
              const entry = parseSceneSource(abs, fs.readFileSync(abs, "utf8"));
              if (vite) {
                invalidateCatalog(vite);
                invalidateSceneLoaders(vite);
              }
              json(res, 200, { ok: true, id, file: `${id}.scene.ts`, entry });
              return;
            }

            if (url === "/__peek" && req.method === "GET") {
              const u = new URL(req.url ?? "", "http://127.0.0.1");
              const file = (u.searchParams.get("file") ?? "").replace(/^\/+/, "");
              const abs = resolveUnder(workspaceRoot, file);
              if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
                json(res, 404, { ok: false, error: "not found" });
                return;
              }
              sendText(res, fs.readFileSync(abs, "utf8"));
              return;
            }
          } catch (err) {
            json(res, 500, {
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            });
            return;
          }
          next();
        })().catch(next);
      });
    },
    transform(code, id) {
      const file = id.split("?")[0] ?? "";
      if (isInjectableTs(workspaceRoot, file) && !isSceneLoadersModule(id)) {
        const rel = workspaceRelPath(path.resolve(file), workspaceRoot);
        return { code: injectSceneSites(code, rel), map: null };
      }
      if (!isSceneLoadersModule(id)) return undefined;
      if (code.includes("/* __scene_hmr_accept */")) return undefined;
      const keys = sceneGlobKeys(sceneDir);
      const helpers = helperGlobKeys(sceneDir);
      if (keys.length === 0 && helpers.length === 0) return undefined;
      return {
        code: code + sceneLoadersAcceptTail(keys, helpers),
        map: null,
      };
    },
    hotUpdate: {
      order: "pre",
      handler(ctx) {
        if (ctx.type !== "update") return;
        const written = rememberedWrite(widgetWrites, ctx.file);
        const helper = isSceneHelper(sceneDir, ctx.file);
        if (written != null) {
          try {
            if (fs.readFileSync(ctx.file, "utf8") === written) return [];
          } catch {
            return [];
          }
        }
        if (helper) {
          if (ctx.modules.length === 0) return;
          const extra = new Set(ctx.modules);
          for (const mod of ctx.modules) {
            for (const importer of mod.importers) {
              const file = (importer.file ?? importer.id ?? "").replace(/\\/g, "/");
              if (file.endsWith(".scene.ts")) extra.add(importer);
            }
          }
          if (vite) {
            vite.ws.send({
              type: "custom",
              event: SCENE_HELPER_HMR_EVENT,
              data: {
                file: workspaceRelPath(ctx.file, workspaceRoot),
              },
            });
          }
          return [...extra];
        }
        if (!isCatalogScene(sceneDir, ctx.file)) return;
        if (!catalogChanged()) return;
        const catalog = this.environment.moduleGraph.getModuleById(VIRTUAL_CATALOG_RESOLVED);
        return catalog ? [...ctx.modules, catalog] : ctx.modules;
      },
    },
  };
}
