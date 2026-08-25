import path from "node:path";

import {
  GREATEST_LOWER_BOUND,
  TraceMap,
  originalPositionFor,
  type EncodedSourceMap,
} from "@jridgewell/trace-mapping";
import type { ViteDevServer } from "vite";

export type StackLoc = {
  file: string;
  line: number;
  column: number;
  name?: string;
};

/** Vite URL for a repo-relative or app-relative (`src/…`) file. The demo is served from `apps/demo`. */
export function viteUrlForRepoFile(
  repoFile: string,
  workspaceRoot: string,
  appRoot: string,
): string {
  const key = repoFile.replace(/^\/+/, "").replace(/\?.*$/, "");
  const root = path.resolve(appRoot).replace(/\\/g, "/");
  const candidates = [path.resolve(workspaceRoot, key), path.resolve(appRoot, key)];
  for (const candidate of candidates) {
    const abs = candidate.replace(/\\/g, "/");
    if (abs === root || abs.startsWith(`${root}/`)) {
      const rel = abs.slice(root.length).replace(/^\//, "");
      return `/${rel}`;
    }
  }
  const abs = path.resolve(workspaceRoot, key).replace(/\\/g, "/");
  return `/@fs${abs.startsWith("/") ? abs : `/${abs}`}`;
}

export function sourceMapFromCode(code: string): EncodedSourceMap | null {
  const m = code.match(/[#@] sourceMappingURL=data:application\/json(?:;charset=utf-8)?;base64,(\S+)/);
  if (!m?.[1]) return null;
  try {
    return JSON.parse(Buffer.from(m[1], "base64").toString("utf8")) as EncodedSourceMap;
  } catch {
    return null;
  }
}

export function originalFromMap(
  map: EncodedSourceMap | TraceMap,
  generatedLine: number,
  generatedColumn: number,
): { line: number; column: number } | null {
  const tracer = map instanceof TraceMap ? map : new TraceMap(map);
  const orig = originalPositionFor(tracer, {
    line: generatedLine,
    column: Math.max(0, generatedColumn - 1),
    bias: GREATEST_LOWER_BOUND,
  });
  if (orig.line == null || orig.column == null) return null;
  return { line: orig.line, column: orig.column + 1 };
}

function mapFromTransform(result: { code: string; map?: EncodedSourceMap | string | null }): EncodedSourceMap | null {
  const raw = result.map;
  if (raw && typeof raw === "string") {
    try {
      return JSON.parse(raw) as EncodedSourceMap;
    } catch {
      return sourceMapFromCode(result.code);
    }
  }
  if (raw && typeof raw === "object") return raw as EncodedSourceMap;
  return sourceMapFromCode(result.code);
}

export function parseStackLocs(frames: unknown): StackLoc[] {
  if (!Array.isArray(frames)) return [];
  const locs: StackLoc[] = [];
  for (const f of frames) {
    if (!f || typeof f !== "object") continue;
    const rec = f as Record<string, unknown>;
    if (typeof rec.file !== "string" || typeof rec.line !== "number" || typeof rec.column !== "number") {
      continue;
    }
    locs.push({
      file: rec.file,
      line: rec.line,
      column: rec.column,
      ...(typeof rec.name === "string" ? { name: rec.name } : {}),
    });
  }
  return locs;
}

export async function remapStackFrames(
  server: ViteDevServer,
  frames: readonly StackLoc[],
  workspaceRoot: string,
  appRoot: string,
): Promise<StackLoc[]> {
  const tracers = new Map<string, TraceMap | null>();
  const out: StackLoc[] = [];
  for (const frame of frames) {
    const url = viteUrlForRepoFile(frame.file, workspaceRoot, appRoot);
    let tracer = tracers.get(url);
    if (tracer === undefined) {
      try {
        const transformed = await server.transformRequest(url);
        const map = transformed ? mapFromTransform(transformed) : null;
        tracer = map ? new TraceMap(map) : null;
      } catch {
        tracer = null;
      }
      tracers.set(url, tracer);
    }
    if (!tracer) {
      out.push(frame);
      continue;
    }
    const orig = originalFromMap(tracer, frame.line, frame.column);
    out.push(orig ? { ...frame, line: orig.line, column: orig.column } : frame);
  }
  return out;
}
