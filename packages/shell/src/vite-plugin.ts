import fs from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin, ViteDevServer } from "vite";
import { parseSceneSource } from "./catalog.ts";
import { isSceneId } from "./layout-grid.ts";
import type { SceneEntry } from "./types.ts";
import {
  insertEditors,
  widgetBindingName,
  widgetInSceneFunction,
  type EditorInsert,
} from "./insert-editor.ts";
import { injectSceneSites } from "./inject-sites.ts";
import { patchWidgetAt } from "./patch-widget.ts";
import { newSceneSource, titleFromId } from "./new-scene.ts";

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
    .filter((n) => n.endsWith(".ts") && !n.endsWith(".d.ts"))
    .map((n) => path.join(sceneDir, n))
    .sort();
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

function catalogFingerprint(sceneDir: string): string {
  return JSON.stringify(scanSceneCatalog(sceneDir));
}

function isSceneTs(sceneDir: string, file: string): boolean {
  const abs = path.resolve(file).replace(/\\/g, "/");
  const dir = path.resolve(sceneDir).replace(/\\/g, "/");
  return (
    abs.startsWith(dir + "/") &&
    abs.endsWith(".ts") &&
    !abs.endsWith(".d.ts")
  );
}

function isSceneLoadersModule(id: string): boolean {
  return path.basename(id.split("?")[0]) === "scene-loaders.ts";
}

function sceneGlobKeys(sceneDir: string): string[] {
  return listSceneFiles(sceneDir).map((abs) => `./scenes/${path.basename(abs)}`);
}

/**
 * Appended onto scene-loaders.ts. Vite rewrites the first array to absolute
 * HMR URLs; the copy passed to applyHotScenes stays as glob keys so hosts
 * can match `./scenes/<file>`. Indices stay aligned.
 */
export function sceneLoadersAcceptTail(keys: string[]): string {
  const lit = JSON.stringify(keys);
  return (
    `\n/* __scene_hmr_accept */\n` +
    `if (import.meta.hot) import.meta.hot.accept(${lit}, (mods) => { if (mods) applyHotScenes(${lit}, mods); });\n`
  );
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

function rememberWidgetWrite(
  writes: Map<string, string>,
  file: string,
  content: string,
): void {
  for (const key of fileAliases(file)) writes.set(key, content);
}

function rememberedWrite(
  writes: Map<string, string>,
  file: string,
): string | undefined {
  for (const key of fileAliases(file)) {
    const content = writes.get(key);
    if (content != null) return content;
  }
  return undefined;
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
        if (!isSceneTs(sceneDir, file)) return;
        if (catalogChanged()) invalidateCatalog(server);
      };
      server.watcher.on("add", onSceneTree);
      server.watcher.on("unlink", onSceneTree);

      server.middlewares.use(async (req, res, next) => {
        const url = req.url?.split("?")[0] ?? "";
        try {
          if (url === "/__write-widget" && req.method === "POST") {
            const raw = JSON.parse(await readBody(req)) as Record<
              string,
              unknown
            >;
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

            const abs = resolveUnder(sceneDir, path.basename(file));
            const source = fs.readFileSync(abs, "utf8");
            const next = patchWidgetAt(source, line, column, values);
            rememberWidgetWrite(widgetWrites, abs, next);
            fs.writeFileSync(abs, next);
            json(res, 200, { ok: true });
            return;
          }

          if (url === "/__insert-editor" && req.method === "POST") {
            const raw = JSON.parse(await readBody(req)) as Record<
              string,
              unknown
            >;
            const file = raw.file;
            const rawEdits = raw.edits;
            if (typeof file !== "string" || !Array.isArray(rawEdits)) {
              json(res, 400, {
                ok: false,
                error: "expected { file, edits }",
              });
              return;
            }
            const abs = resolveUnder(sceneDir, path.basename(file));
            const source = fs.readFileSync(abs, "utf8");
            const edits: EditorInsert[] = [];
            for (const item of rawEdits) {
              if (!item || typeof item !== "object") {
                json(res, 400, { ok: false, error: "invalid edit" });
                return;
              }
              const e = item as Record<string, unknown>;
              if (e.kind === "point") {
                if (typeof e.x !== "number" || typeof e.y !== "number") {
                  json(res, 400, {
                    ok: false,
                    error: "point needs x, y",
                  });
                  return;
                }
                edits.push({ kind: "point", x: e.x, y: e.y });
              } else if (e.kind === "distance") {
                if (typeof e.d !== "number") {
                  json(res, 400, {
                    ok: false,
                    error: "distance needs d",
                  });
                  return;
                }
                let originName =
                  typeof e.originName === "string" ? e.originName : undefined;
                const originAt = e.originAt;
                if (
                  originAt &&
                  typeof originAt === "object" &&
                  typeof (originAt as { line?: unknown }).line === "number" &&
                  typeof (originAt as { column?: unknown }).column === "number"
                ) {
                  const at = {
                    line: (originAt as { line: number }).line,
                    column: (originAt as { column: number }).column,
                  };
                  if (!widgetInSceneFunction(source, at)) {
                    json(res, 400, {
                      ok: false,
                      error:
                        "That handle is not declared in scene() — place a new point, or pick a point that scene() owns.",
                    });
                    return;
                  }
                  const name = widgetBindingName(source, at);
                  if (!name) {
                    json(res, 400, {
                      ok: false,
                      error:
                        "That point is inline, not a named const. Place a new point instead.",
                    });
                    return;
                  }
                  originName = name;
                }
                edits.push({ kind: "distance", originName, d: e.d });
              } else {
                json(res, 400, {
                  ok: false,
                  error: `unknown kind ${String(e.kind)}`,
                });
                return;
              }
            }
            fs.writeFileSync(abs, insertEditors(source, edits));
            for (const key of fileAliases(abs)) widgetWrites.delete(key);
            if (vite) hotReloadSceneFile(vite, abs);
            json(res, 200, { ok: true });
            return;
          }

          if (url === "/__create-scene" && req.method === "POST") {
            const raw = JSON.parse(await readBody(req)) as Record<
              string,
              unknown
            >;
            const id = raw.id;
            if (typeof id !== "string" || !isSceneId(id)) {
              json(res, 400, {
                ok: false,
                error:
                  'id must match [a-z][a-z0-9-]* so it can be a CSS grid area',
              });
              return;
            }
            const abs = resolveUnder(sceneDir, `${id}.ts`);
            if (fs.existsSync(abs)) {
              json(res, 409, {
                ok: false,
                error: `${id}.ts already exists`,
              });
              return;
            }
            const title =
              typeof raw.title === "string" && raw.title.trim()
                ? raw.title.trim()
                : titleFromId(id);
            fs.writeFileSync(abs, newSceneSource(id, title));
            lastCatalog = "";
            if (vite) invalidateCatalog(vite);
            json(res, 200, { ok: true, id, file: `${id}.ts` });
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
      });
    },
    transform(code, id) {
      const file = id.split("?")[0] ?? "";
      if (isSceneTs(sceneDir, file)) {
        return { code: injectSceneSites(code), map: null };
      }
      if (!isSceneLoadersModule(id)) return undefined;
      if (code.includes("/* __scene_hmr_accept */")) return undefined;
      const keys = sceneGlobKeys(sceneDir);
      if (keys.length === 0) return undefined;
      return {
        code: code + sceneLoadersAcceptTail(keys),
        map: null,
      };
    },
    hotUpdate: {
      order: "pre",
      handler(ctx) {
        if (ctx.type !== "update") return;
        if (!isSceneTs(sceneDir, ctx.file)) return;
        const written = rememberedWrite(widgetWrites, ctx.file);
        if (written != null) {
          try {
            if (fs.readFileSync(ctx.file, "utf8") === written) return [];
          } catch {
            return [];
          }
        }
        if (!catalogChanged()) return;
        const catalog = this.environment.moduleGraph.getModuleById(
          VIRTUAL_CATALOG_RESOLVED,
        );
        return catalog ? [...ctx.modules, catalog] : ctx.modules;
      },
    },
  };
}
