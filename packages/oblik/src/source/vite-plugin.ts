import fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";

import type { EnvironmentModuleNode, Plugin, ViteDevServer } from "vite";
import { transformSync } from "esbuild";

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
import { moduleRefToSpecifier } from "./tool-path";
import { isUserAppSource, listUserAppSources } from "./user-source";

const VIRTUAL_ANN = "virtual:oblik-annotations";
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

/**
 * Non-scene user modules (layout/helper files like `src/layout/tools.ts`) are
 * given a self-accept in `transform`. Without it an edit to such a module
 * escalates to a full page reload — nothing on the path from the demo entry
 * accepts it. Scene files are excluded: they are already accepted by the
 * virtual loaders, and adding a self-accept there would swallow the loader
 * notification that replaces the scene module.
 */
const LIB_HMR_TAIL = `
/* __oblik_lib_hmr */
if (import.meta.hot) { import.meta.hot.accept(); }
`;
const APP_ENTRY_FILE = /[\\/]main\.ts$/;

function isLibraryFile(sceneDir: string, file: string): boolean {
  return !isSceneTs(sceneDir, file) && !APP_ENTRY_FILE.test(file);
}

/**
 * All loaded app modules that must refresh when a library file changes: the
 * changed module plus every app-source importer up to (and including) the
 * scene modules. Scene modules have no self-accept, so returning them hands
 * the update to the virtual loaders' accept → `applyHotScenes` re-executes the
 * scene against the freshly re-imported library.
 */
function libraryUpdateModules(
  seed: ReadonlySet<EnvironmentModuleNode>,
  appRoot: string,
): EnvironmentModuleNode[] {
  const out: EnvironmentModuleNode[] = [];
  const seen = new Set<EnvironmentModuleNode>();
  const queue = [...seed];
  for (const m of seed) seen.add(m);
  while (queue.length > 0) {
    const m = queue.shift()!;
    out.push(m);
    for (const imp of m.importers) {
      if (seen.has(imp)) continue;
      seen.add(imp);
      const file = imp.id?.split("?")[0] ?? "";
      if (!file) continue;
      if (!isUserAppSource(appRoot, file)) continue;
      if (APP_ENTRY_FILE.test(file)) continue; // entry has no accept — never route through it
      queue.push(imp);
    }
  }
  return out;
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
          let job = parseInsert(body);
          if (typeof job === "string") {
            json(res, 400, { ok: false, error: job });
            return;
          }
          try {
            const abs = resolveUnder(workspaceRoot, job.file);
            // Registered-tool inserts carry the tool's served URL pathname;
            // map it to a relative specifier from the dest file before insert.
            if (job.tool) {
              const spec = moduleRefToSpecifier(abs, job.tool.module, server.config.root);
              job = { ...job, tool: { module: spec, prefix: job.tool.prefix } };
            }
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
    },
    transform(_code, id) {
      const file = id.split("?")[0] ?? id;
      if (!isUserAppSource(appRoot, file)) return undefined;
      // Pre-phase plugins (e.g. esbuild, @solidjs/vite-plugin's enforce:"pre"
      // pass) reprint modules, so `code` here is not the file as authored.
      // Stamp and serve the canonical on-disk source; otherwise a missing-id
      // write-back rewrites the file in the upstream formatter's style.
      const abs = path.resolve(file);
      const onDisk = fs.readFileSync(abs, "utf8");
      // Vite chains maps by source name — this must match the module Vite is serving
      // (`src/layout/foo.ts`), not a repo path (`apps/demo/src/layout/foo.ts`).
      const viteSource = path.relative(appRoot, file).replace(/\\/g, "/");
      const isLib = isLibraryFile(sceneDir, file);
      const { source, added, map } = stamp(onDisk, freshSiteId, viteSource);
      if (added.length === 0 && !isLib) return undefined;
      if (added.length > 0) void enqueue(abs, () => fs.writeFileSync(abs, source));
      if (!isLib) return { code: source, map };
      // Library module: emit finished JS. This transform runs *after* the
      // upstream esbuild pass, so returning the raw on-disk TS here (which may
      // hold `import type` / parameter annotations) would ship un-transpiled
      // TypeScript to the browser. Compile the stamped source and append the
      // self-accept that stops helper edits from full-reloading the page.
      const tsBody = added.length > 0 ? source : onDisk;
      const compiled = transformSync(tsBody + LIB_HMR_TAIL, {
        loader: "ts",
        format: "esm",
        target: "esnext",
        sourcemap: "inline",
        sourcefile: viteSource,
      });
      return { code: compiled.code };
    },
    hotUpdate(options) {
      const env = this.environment;
      if (env.name !== "client") return; // ssr graph has no oblik virtuals; default handling is a no-op there
      if (!isUserAppSource(appRoot, options.file)) return;
      // Bundle/catalog/loaders must ride in the SAME update payload as the
      // scene modules. reloadModule would deliver each as its own HMR event,
      // and every event runs bootstrap's accept callbacks in a fresh task —
      // one world re-run per event instead of one per edit.
      const bundle = env.moduleGraph.getModuleById(VIRTUAL_ANN_BUNDLE_RESOLVED);
      const extra = bundle ? [bundle] : [];
      if (APP_ENTRY_FILE.test(options.file)) return undefined; // re-running bootstrap under HMR would double-mount — reload instead
      if (!isSceneTs(sceneDir, options.file)) {
        // Library module (e.g. a tool/layout file): it self-accepts in the
        // transform, so push the change through the loaded scenes that import
        // it — their loader accept re-executes them against the new module.
        const changed = env.moduleGraph.getModulesByFile(options.file);
        if (!changed || changed.size === 0) return extra.length > 0 ? extra : undefined;
        const updates = libraryUpdateModules(changed, appRoot);
        return updates.length > 0 ? [...updates, ...extra] : extra;
      }
      if (catalogChanged()) {
        const catalog = env.moduleGraph.getModuleById(VIRTUAL_CATALOG_RESOLVED);
        if (catalog) extra.push(catalog);
        const loaders = env.moduleGraph.getModuleById(VIRTUAL_LOADERS_RESOLVED);
        if (loaders) extra.push(loaders);
      }
      // A scene module the client pruned (empty-file add / delete drops it
      // from the loaders) keeps its module node but loses every importer
      // edge; letting it ride the payload dead-ends vite's update walk into a
      // full page reload. hotUpdate runs for create/delete events too (the
      // legacy handleHotUpdate did not), which is what made recreate-then-edit
      // reload. The extras still reach bootstrap's accepts, and the next
      // loader call imports the scene fresh.
      const live = options.modules.filter((mod) => mod.importers.size > 0);
      return live.length > 0 || extra.length > 0 ? [...live, ...extra] : undefined;
    },
  };
}
