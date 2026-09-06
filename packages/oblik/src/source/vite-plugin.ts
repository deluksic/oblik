import fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";

import type { Plugin, ViteDevServer } from "vite";

import { analyze } from "./analyze";
import {
  scanAnnotationsBundle,
  scanMentionsBundle,
  scanOblikCatalog,
  sceneGlobKeys,
  sceneLoadersModule,
} from "./catalog";
import { patchFrame } from "./frame-edit";
import { insertCall, exposeReturnBag } from "./insert";
import { parseStackLocs, remapStackFrames } from "./map-stack";
import { patchPaintStyle, removePaintCall } from "./paint-edit";
import { patchLiterals } from "./patch";
import { resolveSceneFileAbs } from "./scene-path.server";
import {
  parseErase,
  parseExpose,
  parseFrameEdit,
  parseInsert,
  parseLiteralPatch,
  parsePaintPatch,
} from "./schema";
import { freshSiteId, stamp } from "./stamp";
import { isUserAppSource, listUserAppSources } from "./user-source";

const VIRTUAL_ANN = "virtual:oblik-annotations";
const VIRTUAL_ANN_RESOLVED = "\0" + VIRTUAL_ANN;
const VIRTUAL_ANN_BUNDLE_RESOLVED = "\0virtual:oblik-annotations-bundle";
const VIRTUAL_CATALOG = "virtual:oblik-catalog";
const VIRTUAL_CATALOG_RESOLVED = "\0" + VIRTUAL_CATALOG;
const VIRTUAL_LOADERS = "virtual:oblik-loaders";
const VIRTUAL_LOADERS_RESOLVED = "\0" + VIRTUAL_LOADERS;

const FALLBACK_INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>oblik</title>
    <style>
      html,
      body,
      #app {
        height: 100%;
        overflow: hidden;
        background: #0e1016;
      }
    </style>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`;

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
  const mod = server.moduleGraph.getModuleById(VIRTUAL_LOADERS_RESOLVED);
  if (mod) void server.reloadModule(mod);
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
      if (!fs.existsSync(path.join(server.config.root, "index.html"))) {
        // Serve a shell for "/" so apps can mount with just a main.tsx.
        server.middlewares.use((req, res, next) => {
          // Compare pathname only: "/?scene=x" must still hit the shell.
          const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
          if (req.method !== "GET" || (pathname !== "/" && pathname !== "/index.html")) {
            next();
            return;
          }
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.end(FALLBACK_INDEX_HTML);
        });
      }
      const onSceneTree = (file: string) => {
        if (!isUserAppSource(appRoot, file)) return;
        invalidateAnnotationsBundle(server);
        if (isSceneTs(sceneDir, file) && catalogChanged()) {
          invalidateCatalog(server);
          invalidateSceneLoaders(server);
        }
      };
      server.watcher.on("add", onSceneTree);
      server.watcher.on("unlink", onSceneTree);

      async function handleOblikMiddleware(
        req: IncomingMessage,
        res: ServerResponse,
        next: () => void,
      ): Promise<void> {
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
            const patched = patchLiterals(src, patch.id, patch.values);
            if (patched === undefined) {
              json(res, 400, { ok: false, error: "could not patch id" });
              return;
            }
            await enqueue(abs, () => fs.writeFileSync(abs, patched));
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
            const patched = insertCall(src, job);
            await enqueue(abs, () => fs.writeFileSync(abs, patched));
            json(res, 200, { ok: true });
          } catch (err) {
            json(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) });
          }
          return;
        }
        if (req.method === "POST" && req.url === "/__oblik-expose") {
          let body: unknown;
          try {
            body = JSON.parse(await readBody(req));
          } catch {
            json(res, 400, { ok: false, error: "invalid json" });
            return;
          }
          const job = parseExpose(body);
          if (typeof job === "string") {
            json(res, 400, { ok: false, error: job });
            return;
          }
          try {
            const abs = resolveUnder(workspaceRoot, job.file);
            const src = fs.readFileSync(abs, "utf8");
            const patched = exposeReturnBag(src, job.dest, job.bind);
            await enqueue(abs, () => fs.writeFileSync(abs, patched));
            json(res, 200, { ok: true });
          } catch (err) {
            json(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) });
          }
          return;
        }
        if (req.method === "POST" && req.url === "/__oblik-paint-style") {
          let body: unknown;
          try {
            body = JSON.parse(await readBody(req));
          } catch {
            json(res, 400, { ok: false, error: "invalid json" });
            return;
          }
          const job = parsePaintPatch(body);
          if (typeof job === "string") {
            json(res, 400, { ok: false, error: job });
            return;
          }
          try {
            const abs = resolveUnder(workspaceRoot, job.file);
            const src = fs.readFileSync(abs, "utf8");
            const patched = patchPaintStyle(src, job.id, job.style);
            await enqueue(abs, () => fs.writeFileSync(abs, patched));
            json(res, 200, { ok: true });
          } catch (err) {
            json(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) });
          }
          return;
        }
        if (req.method === "POST" && req.url === "/__oblik-frame") {
          let body: unknown;
          try {
            body = JSON.parse(await readBody(req));
          } catch {
            json(res, 400, { ok: false, error: "invalid json" });
            return;
          }
          const job = parseFrameEdit(body);
          if (typeof job === "string") {
            json(res, 400, { ok: false, error: job });
            return;
          }
          try {
            const abs = resolveUnder(workspaceRoot, job.file);
            const src = fs.readFileSync(abs, "utf8");
            const patched = patchFrame(src, job.frame);
            if (patched === undefined) {
              json(res, 400, { ok: false, error: "could not patch frame" });
              return;
            }
            await enqueue(abs, () => fs.writeFileSync(abs, patched));
            json(res, 200, { ok: true });
          } catch (err) {
            json(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) });
          }
          return;
        }
        if (req.method === "POST" && req.url === "/__oblik-erase") {
          let body: unknown;
          try {
            body = JSON.parse(await readBody(req));
          } catch {
            json(res, 400, { ok: false, error: "invalid json" });
            return;
          }
          const job = parseErase(body);
          if (typeof job === "string") {
            json(res, 400, { ok: false, error: job });
            return;
          }
          try {
            const abs = resolveUnder(workspaceRoot, job.file);
            const src = fs.readFileSync(abs, "utf8");
            const patched = removePaintCall(src, job.id);
            await enqueue(abs, () => fs.writeFileSync(abs, patched));
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
      }

      server.middlewares.use((req, res, next) => {
        void handleOblikMiddleware(req, res, next).catch(next);
      });
    },
    resolveId(id, importer) {
      if (id === VIRTUAL_CATALOG) return VIRTUAL_CATALOG_RESOLVED;
      if (id === VIRTUAL_ANN) return VIRTUAL_ANN_BUNDLE_RESOLVED;
      if (id.startsWith(`${VIRTUAL_ANN}?`)) {
        return VIRTUAL_ANN_RESOLVED + id.slice(VIRTUAL_ANN.length);
      }
      if (id === VIRTUAL_LOADERS) return VIRTUAL_LOADERS_RESOLVED;
      // Loader keys are app-src-relative ("./scenes/x.ts"); the virtual module
      // has no directory, so anchor them where scene-loaders.ts used to live.
      if (importer === VIRTUAL_LOADERS_RESOLVED && (id.startsWith("./") || id.startsWith("../"))) {
        return path.resolve(path.join(appRoot, "src"), id);
      }
    },
    load(id) {
      if (id === VIRTUAL_CATALOG_RESOLVED) {
        const scenes = scanOblikCatalog(sceneDir, workspaceRoot);
        lastCatalog = JSON.stringify(scenes);
        return `export const scenes = ${JSON.stringify(scenes)};\n`;
      }
      if (id === VIRTUAL_ANN_BUNDLE_RESOLVED) {
        const files = listUserAppSources(appRoot);
        const { byPath, collisions } = scanAnnotationsBundle(files, workspaceRoot);
        const mentionsByPath = scanMentionsBundle(files, workspaceRoot);
        return `export const annotationsByPath = ${JSON.stringify(byPath)};
export const annotationCollisions = ${JSON.stringify(collisions)};
export const mentionsByPath = ${JSON.stringify(mentionsByPath)};
`;
      }
      if (id === VIRTUAL_LOADERS_RESOLVED) {
        return sceneLoadersModule(sceneGlobKeys(sceneDir));
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
    transform(_code, id) {
      const file = id.split("?")[0] ?? id;
      if (!isUserAppSource(appRoot, file)) return undefined;
      // Pre-phase plugins (e.g. @solidjs/vite-plugin's enforce:"pre" pass)
      // reprint modules, so `code` here is not the file as authored. Stamp
      // and serve the canonical on-disk source; otherwise a missing-id
      // write-back rewrites the file in the upstream formatter's style.
      const abs = path.resolve(file);
      const onDisk = fs.readFileSync(abs, "utf8");
      // Vite chains maps by source name — this must match the module Vite is serving
      // (`src/layout/foo.ts`), not a repo path (`apps/demo/src/layout/foo.ts`).
      const viteSource = path.relative(appRoot, file).replace(/\\/g, "/");
      const { source, added, map } = stamp(onDisk, freshSiteId, viteSource);
      if (added.length === 0) return undefined;
      void enqueue(abs, () => fs.writeFileSync(abs, source));
      return { code: source, map };
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
        const catalog = server.moduleGraph.getModuleById(VIRTUAL_CATALOG_RESOLVED);
        if (catalog) extra.push(catalog);
      }
      return extra.length > 0 ? [...ctx.modules, ...extra] : ctx.modules;
    },
  };
}
