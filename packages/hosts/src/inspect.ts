import { enqueueLatest, writeSlot } from "./write-queue";

export function quantize(n: number): number {
  return Math.round(n * 100) / 100;
}

/** World cursor for the pane status strip: always two decimals, tabular. */
export function formatWorldCursor(p: { x: number; y: number }): string {
  return `${quantize(p.x).toFixed(2)}, ${quantize(p.y).toFixed(2)}`;
}

export function escapeHtml(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function renderSnippet(text: string, line: number): string {
  const lines = text.split("\n");
  const i = line - 1;
  const from = Math.max(0, i - 5);
  const to = Math.min(lines.length, i + 6);
  const chunks: string[] = [];
  for (let n = from; n < to; n++) {
    const current = n === i;
    const num = String(n + 1).padStart(4, " ");
    const body = escapeHtml(lines[n] ?? "");
    chunks.push(
      `<div class="${current ? "hl" : ""}"><span class="ln">${num}</span><span class="tx">${body}</span></div>`,
    );
  }
  return chunks.join("");
}

export type StackFrame = {
  file: string;
  line: number;
  column: number;
  name?: string;
};

function fileName(file: string): string {
  return file.split("/").pop() ?? file;
}

function frameWho(f: StackFrame): string {
  const named = f.name?.trim();
  if (named) return named;
  return fileName(f.file).replace(/\.(scene\.)?tsx?$/, "");
}

/** Short origin line for inspect meta — not a traceback. */
export function stackLabel(frames: readonly StackFrame[]): string {
  if (frames.length === 0) return "";
  const leaf = frames[0]!;
  const who = frameWho(leaf);
  const file = fileName(leaf.file);
  if (frames.length === 1) return `Built in ${file}`;
  return `From ${who} in ${file}`;
}

export { stackLabel as originLabel };

/**
 * Error.stack is numbered against Vite's transformed JS. Map back to disk
 * through the module source map before highlighting.
 */
export async function mapStack(frames: readonly StackFrame[]): Promise<StackFrame[]> {
  if (frames.length === 0) return [];
  try {
    const res = await fetch("/__map-stack", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ frames }),
    });
    if (!res.ok) return frames.map((f) => ({ ...f }));
    const body = (await res.json()) as { frames?: StackFrame[] };
    return Array.isArray(body.frames) ? body.frames : frames.map((f) => ({ ...f }));
  } catch {
    return frames.map((f) => ({ ...f }));
  }
}

/** Constructor CallExpression from `__annotations__` is disk-accurate. */
export function pinConstructorSite(
  frames: readonly StackFrame[],
  site?: { file: string; line: number; column: number },
): StackFrame[] {
  if (!site || frames.length === 0) return frames.map((f) => ({ ...f }));
  const next = frames.map((f) => ({ ...f }));
  next[0] = { ...next[0]!, file: site.file, line: site.line, column: site.column };
  return next;
}

function quoteLines(text: string, line: number): import("@design-scenes/shell").OriginQuoteLine[] {
  const rows = text.split("\n");
  const i = line - 1;
  const from = Math.max(0, i - 1);
  const to = Math.min(rows.length, i + 2);
  const out: import("@design-scenes/shell").OriginQuoteLine[] = [];
  for (let n = from; n < to; n++) {
    out.push({ line: n + 1, text: rows[n] ?? "", current: n === i });
  }
  return out;
}

/** Innermost helper first. Quote the construction; list callers as a path. */
export async function originFromStack(
  frames: readonly StackFrame[],
  cache: Map<string, string>,
): Promise<import("@design-scenes/shell").OriginView> {
  if (frames.length === 0) {
    return { kind: "empty", message: "No source location for this object." };
  }
  const leaf = frames[0]!;
  const who = frameWho(leaf);
  const file = fileName(leaf.file);
  let quote: import("@design-scenes/shell").OriginQuoteLine[] = [];
  try {
    const text = await peekFile(cache, leaf.file);
    quote = quoteLines(text, leaf.line);
  } catch (err) {
    return {
      kind: "empty",
      message: err instanceof Error ? err.message : String(err),
    };
  }
  return {
    kind: "origin",
    who,
    file,
    quote,
    callers: frames.slice(1).map((f) => ({
      who: frameWho(f),
      loc: `${fileName(f.file)}:${f.line}`,
    })),
  };
}

export async function peekFile(cache: Map<string, string>, file: string): Promise<string> {
  const key = file.replace(/^\/+/, "").replace(/\?.*$/, "");
  const cached = cache.get(key);
  if (cached != null) return cached;
  const res = await fetch(`/__peek?file=${encodeURIComponent(key)}`);
  if (!res.ok) throw new Error(`Could not read ${key}`);
  const text = await res.text();
  cache.set(key, text);
  return text;
}

export async function commitWidget(
  at: { file: string; line: number; column: number },
  values: number[],
): Promise<string | null> {
  return enqueueLatest(at.file, writeSlot(at, "widget"), values, (next) => postWidget(at, next));
}

async function postWidget(
  at: { file: string; line: number; column: number },
  values: number[],
): Promise<string | null> {
  const res = await fetch("/__write-widget", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      file: at.file,
      line: at.line,
      column: at.column,
      values,
    }),
  });
  const body = (await res.json()) as { ok?: boolean; error?: string };
  if (!res.ok || !body.ok) {
    return body.error ?? `write failed (${res.status})`;
  }
  return null;
}

export async function commitStyle(
  at: { file: string; line: number; column: number },
  style: import("@design-scenes/shell").ObjectStyle | null,
): Promise<string | null> {
  return enqueueLatest(at.file, writeSlot(at, "style"), style, (next) => postStyle(at, next));
}

async function postStyle(
  at: { file: string; line: number; column: number },
  style: import("@design-scenes/shell").ObjectStyle | null,
): Promise<string | null> {
  const res = await fetch("/__write-style", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      file: at.file,
      line: at.line,
      column: at.column,
      style,
    }),
  });
  const body = (await res.json()) as { ok?: boolean; error?: string };
  if (!res.ok || !body.ok) {
    return body.error ?? `write failed (${res.status})`;
  }
  return null;
}

export type ScenePatch = {
  hoistAt?: { line: number; column: number }[];
  imports?: Record<string, string[]>;
  statements?: string[];
  exprs?: string[];
};

export async function commitScenePatch(
  sceneFile: string,
  patch: ScenePatch,
): Promise<string | null> {
  const res = await fetch("/__insert-editor", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file: sceneFile, ...patch }),
  });
  const body = (await res.json()) as { ok?: boolean; error?: string };
  if (!res.ok || !body.ok) {
    return body.error ?? `insert failed (${res.status})`;
  }
  return null;
}
