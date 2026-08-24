import fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";

import type { Plugin } from "vite";

import { analyze } from "./analyze";
import { patchLiterals } from "./patch";
import { parseLiteralPatch } from "./schema";
import { stamp } from "./stamp";

const VIRTUAL_PREFIX = "virtual:oblik-annotations";
const VIRTUAL_RESOLVED = "\0" + VIRTUAL_PREFIX;

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

export function oblikPlugin(opts: OblikPluginOpts): Plugin {
  const workspaceRoot = path.resolve(opts.workspaceRoot);
  const sceneDir = path.resolve(opts.sceneDir);
  const writeTail = new Map<string, Promise<void>>();

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
        next();
      });
    },
    resolveId(id) {
      if (id === VIRTUAL_PREFIX || id.startsWith(`${VIRTUAL_PREFIX}?`)) return VIRTUAL_RESOLVED + id.slice(VIRTUAL_PREFIX.length);
    },
    load(id) {
      if (!id.startsWith(VIRTUAL_RESOLVED)) return;
      const q = id.includes("?") ? id.slice(id.indexOf("?") + 1) : "";
      const params = new URLSearchParams(q);
      const file = params.get("file");
      if (!file) return "export default {}";
      const abs = resolveUnder(workspaceRoot, file);
      const src = fs.readFileSync(abs, "utf8");
      const map = analyze(src, file.replace(/\\/g, "/"));
      return `export default ${JSON.stringify(Object.fromEntries(map))};\n`;
    },
    transform(code, id) {
      const file = id.split("?")[0] ?? id;
      if (!isSceneTs(sceneDir, file)) return null;
      const { source, added } = stamp(code);
      if (added.length > 0) {
        const abs = path.resolve(file);
        void enqueue(abs, () => fs.writeFileSync(abs, source));
      }
      return { code: source, map: null };
    },
    handleHotUpdate({ server }) {
      for (const mod of server.moduleGraph.idToModuleMap.values()) {
        if (mod.id?.startsWith(VIRTUAL_RESOLVED)) void server.reloadModule(mod);
      }
    },
  };
}
