import fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";

import type { Plugin, ViteDevServer } from "vite";

import { analyze } from "./analyze";
import {
  listCatalogFiles,
  scanAnnotationsBundle,
  scanOblikCatalog,
  sceneGlobKeys,
  sceneLoadersModule,
} from "./catalog";
import { insertCall } from "./insert";
import { parseStackLocs, remapStackFrames } from "./map-stack";
import { patchLiterals } from "./patch";
import { resolveSceneFileAbs } from "./scene-path.server";
import { parseInsert, parseLiteralPatch } from "./schema";
import { stamp } from "./stamp";
import { appSrcImportKey, isUserAppSource, listUserAppSources } from "./user-source";

const VIRTUAL_ANN = "virtual:oblik-annotations";
const VIRTUAL_ANN_RESOLVED = "\0" + VIRTUAL_ANN;
const VIRTUAL_ANN_BUNDLE_RESOLVED = "\0virtual:oblik-annotations-bundle";
const VIRTUAL_CATALOG = "virtual:oblik-catalog";
const VIRTUAL_CATALOG_RESOLVED = "\0" + VIRTUAL_CATALOG;

export type OblikPluginOpts = {
  workspaceRoot: string;
  sceneDir: string;
};

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
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
  if (abs !== root && !abs.startsWith(prefix)) throw new Error("path escapes sandbox");
  return abs;
}

function isSceneTs(sceneDir: string, file: string): boolean {
  const abs = path.resolve(file).replace(/\\/g, "/");
  const dir = path.resolve(sceneDir).replace(/\\/g, "/");
  return abs.startsWith(`${dir}/`) && abs.endsWith(".ts") && !abs.endsWith(".d.ts");
}

function isSceneLoadersModule(id: string): boolean {
  return path.basename(id.split("?")[0] ?? id) === "scene-loaders.ts";
}

function catalogFingerprint(sceneDir: string, workspaceRoot: string): string {
  return JSON.stringify(scanOblikCatalog(sceneDir, workspaceRoot));
}

function invalidateCatalog(server: ViteDevServer): void {
  const mod = server.moduleGraph.getModuleById(VIRTUAL_CATALOG_RESOLVED);
  if (mod) void server.reloadModule(mod);
}

function invalidateAnnotationsBundle(server: ViteDevServer): void {
  const mod = server.moduleGraph.getModuleById(VIRTUAL_ANN_BUNDLE_RESOLVED);
  if (mod) void server.reloadModule(mod);
}

function invalidateSceneLoaders(server: ViteDevServer): void {
  for (const mod of server.moduleGraph.idToModuleMap.values()) {
    const file = mod.file?.replace(/\\/g, "/") ?? "";
    if (file.endsWith("/scene-loaders.ts")) void server.reloadModule(mod);
  }
}

function invalidateCatalogConsumers(server: ViteDevServer): void {
  const catalog = server.moduleGraph.getModuleById(VIRTUAL_CATALOG_RESOLVED);
  if (!catalog) return;
  for (const importer of [...catalog.importers]) void server.reloadModule(importer);
}

function helperImportKeys(appRoot: string, sceneDir: string): string[] {
  const catalog = new Set(listCatalogFiles(sceneDir).map((abs) => path.resolve(abs)));
  return listUserAppSources(appRoot)
    .filter((abs) => !catalog.has(path.resolve(abs)))
    .map((abs) => appSrcImportKey(appRoot, abs));
}

export function oblikPlugin(opts: OblikPluginOpts): Plugin {
  const workspaceRoot = path.resolve(opts.workspaceRoot);
  const sceneDir = path.resolve(opts.sceneDir);
  const appRoot = path.dirname(path.dirname(sceneDir));
  const writeTail = new Map<string, Promise<void>>();
  let lastCatalog = "";

  function catalogChanged(): boolean {
    const next = catalogFingerprint(sceneDir, workspaceRoot);
    if (next === lastCatalog) return false;
    lastCatalog = next;
    return true;
  }

  function enqueue(abs: string, work: () => void): Promise<void> {
    const run = () => Promise.resolve().then(work);
    const prev = writeTail.get(abs) ?? Promise.resolve();
    const next = prev.then(run, run);
    writeTail.set(
      abs,
      next.then(
        () => undefined,
        () => undefined,
      ),
    );
    return next;
  }

  return {
    name: "oblik",
    configureServer(server) {
      server.watcher.add(path.join(appRoot, "src"));
      const onSceneTree = (file: string) => {
        if (!isUserAppSource(appRoot, file)) return;
        invalidateAnnotationsBundle(server);
        if (isSceneTs(sceneDir, file) && catalogChanged()) {
          invalidateCatalog(server);
          invalidateSceneLoaders(server);
          invalidateCatalogConsumers(server);
        } else {
          invalidateSceneLoaders(server);
        }
      };
      server.watcher.on("add", onSceneTree);
      server.watcher.on("unlink", onSceneTree);

      server.middlewares.use(async (req, res, next) => {
        if (req.method === "POST" && req.url === "/__oblik-patch") {
          let body: unknown;
          try {
            body = JSON.parse(await readBody(req));
          } catch {
            json(res, 400, { ok: false, error: "invalid json" });
            return;
          }
          const patch = parseLiteralPatch(body);
          if (typeof patch === "string") {
            json(res, 400, { ok: false, error: patch });
            return;
          }
          try {
            const abs = resolveUnder(workspaceRoot, patch.file);
            const src = fs.readFileSync(abs, "utf8");
            const next = patchLiterals(src, patch.id, patch.values);
            if (next == null) {
              json(res, 400, { ok: false, error: "could not patch id" });
              return;
            }
            await enqueue(abs, () => fs.writeFileSync(abs, next));
            json(res, 200, { ok: true });
          } catch (err) {
            json(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) });
          }
          return;
        }
        if (req.method === "POST" && req.url === "/__oblik-insert") {
          let body: unknown;
          try {
            body = JSON.parse(await readBody(req));
          } catch {
            json(res, 400, { ok: false, error: "invalid json" });
            return;
          }
          const job = parseInsert(body);
          if (typeof job === "string") {
            json(res, 400, { ok: false, error: job });
            return;
          }
          try {
            const abs = resolveUnder(workspaceRoot, job.file);
            const src = fs.readFileSync(abs, "utf8");
            const next = insertCall(src, job);
            await enqueue(abs, () => fs.writeFileSync(abs, next));
            json(res, 200, { ok: true });
          } catch (err) {
            json(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) });
          }
          return;
        }
        if (req.method === "GET" && req.url?.startsWith("/__peek?")) {
          const url = new URL(req.url, "http://localhost");
          const file = url.searchParams.get("file");
          if (!file) {
            res.statusCode = 400;
            res.end("missing file");
            return;
          }
          try {
            const abs = resolveSceneFileAbs(workspaceRoot, sceneDir, file);
            res.setHeader("Content-Type", "text/plain; charset=utf-8");
            res.end(fs.readFileSync(abs, "utf8"));
          } catch (err) {
            res.statusCode = 404;
            res.end(err instanceof Error ? err.message : String(err));
          }
          return;
        }
        if (req.method === "POST" && req.url === "/__map-stack") {
          let body: unknown;
          try {
            body = JSON.parse(await readBody(req));
          } catch {
            json(res, 400, { error: "invalid json" });
            return;
          }
          const frames = parseStackLocs(
            body && typeof body === "object" ? (body as { frames?: unknown }).frames : [],
          );
          try {
            json(res, 200, {
              frames: await remapStackFrames(server, frames, workspaceRoot, appRoot),
            });
          } catch (err) {
            json(res, 500, { error: err instanceof Error ? err.message : String(err) });
          }
          return;
        }
        next();
      });
    },
    resolveId(id) {
      if (id === VIRTUAL_CATALOG) return VIRTUAL_CATALOG_RESOLVED;
      if (id === VIRTUAL_ANN) return VIRTUAL_ANN_BUNDLE_RESOLVED;
      if (id.startsWith(`${VIRTUAL_ANN}?`)) {
        return VIRTUAL_ANN_RESOLVED + id.slice(VIRTUAL_ANN.length);
      }
    },
    load(id) {
      if (id === VIRTUAL_CATALOG_RESOLVED) {
        const scenes = scanOblikCatalog(sceneDir, workspaceRoot);
        lastCatalog = JSON.stringify(scenes);
        return `export const scenes = ${JSON.stringify(scenes)};\n`;
      }
      if (id === VIRTUAL_ANN_BUNDLE_RESOLVED) {
        const bundle = scanAnnotationsBundle(listUserAppSources(appRoot), workspaceRoot, (src, file) =>
          analyze(src, file),
        );
        return `export const annotationsByPath = ${JSON.stringify(bundle)};\n`;
      }
      if (!id.startsWith(VIRTUAL_ANN_RESOLVED)) return;
      const q = id.includes("?") ? id.slice(id.indexOf("?") + 1) : "";
      const params = new URLSearchParams(q);
      const file = params.get("file");
      if (!file) return "export default {};\n";
      const abs = resolveUnder(workspaceRoot, file);
      const src = fs.readFileSync(abs, "utf8");
      const map = analyze(src, file.replace(/\\/g, "/"));
      return `export default ${JSON.stringify(Object.fromEntries(map))};\n`;
    },
    transform(code, id) {
      const file = id.split("?")[0] ?? id;
      if (isSceneLoadersModule(id)) {
        return { code: sceneLoadersModule(sceneGlobKeys(sceneDir), helperImportKeys(appRoot, sceneDir)), map: null };
      }
      if (!isUserAppSource(appRoot, file)) return null;
      const { source, added } = stamp(code);
      if (added.length > 0) {
        const abs = path.resolve(file);
        void enqueue(abs, () => fs.writeFileSync(abs, source));
      }
      return { code: source, map: null };
    },
    handleHotUpdate(ctx) {
      const server = ctx.server;
      if (!isUserAppSource(appRoot, ctx.file)) return;
      invalidateAnnotationsBundle(server);
      for (const mod of server.moduleGraph.idToModuleMap.values()) {
        if (mod.id?.startsWith(VIRTUAL_ANN_RESOLVED)) void server.reloadModule(mod);
      }
      const bundle = server.moduleGraph.getModuleById(VIRTUAL_ANN_BUNDLE_RESOLVED);
      const extra = bundle ? [bundle] : [];
      if (isSceneTs(sceneDir, ctx.file) && catalogChanged()) {
        invalidateCatalog(server);
        invalidateSceneLoaders(server);
        invalidateCatalogConsumers(server);
        const catalog = server.moduleGraph.getModuleById(VIRTUAL_CATALOG_RESOLVED);
        if (catalog) extra.push(catalog);
      } else if (!isSceneTs(sceneDir, ctx.file)) {
        invalidateSceneLoaders(server);
      }
      return extra.length > 0 ? [...ctx.modules, ...extra] : ctx.modules;
    },
  };
}
