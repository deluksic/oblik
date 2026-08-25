import type { CallSite } from "../eval/stack";
import { isUserSourcePath } from "../eval/stack";
import type { TraceNode } from "../eval/context";
import { normalizeSceneRelPath } from "../source/scene-path";

export type OriginCodeLine = {
  kind: "code";
  line: number;
  text: string;
  current?: boolean;
};

export type OriginDisplayLine =
  | OriginCodeLine
  | { kind: "header"; line: number; text: string }
  | { kind: "ellipsis" };

export type OriginFrame = {
  file: string;
  lines: OriginDisplayLine[];
};

export type OriginView =
  | { kind: "empty"; message: string }
  | { kind: "origin"; frames: OriginFrame[] };

export type SelectionDetail = {
  crumb: string;
  meta: string;
  origin: OriginView;
};

export const EMPTY_SELECTION_DETAIL: SelectionDetail = {
  crumb: "Nothing selected",
  meta: "Hover or click geometry to inspect it.",
  origin: { kind: "empty", message: "Select something to see where it comes from." },
};

function fileName(file: string): string {
  return file.split("/").pop() ?? file;
}

function frameWho(f: CallSite): string {
  const named = f.name?.trim();
  if (named) return named;
  return fileName(f.file).replace(/\.(scene\.)?tsx?$/, "");
}

export function stackLabel(frames: readonly CallSite[]): string {
  if (frames.length === 0) return "";
  const leaf = frames[0]!;
  const who = frameWho(leaf);
  const file = fileName(leaf.file);
  if (frames.length === 1) return `Built in ${file}`;
  return `From ${who} in ${file}`;
}

export function pinConstructorSite(
  frames: readonly CallSite[],
  site?: { file: string; line: number; column: number },
): CallSite[] {
  if (!site) return frames.map((f) => ({ ...f }));
  if (frames.length === 0) {
    return [{ file: site.file, line: site.line, column: site.column }];
  }
  const next = frames.map((f) => ({ ...f }));
  next[0] = { ...next[0]!, file: site.file, line: site.line, column: site.column };
  return next;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function findFunctionHeaderRow(rows: readonly string[], line: number, name?: string): number | null {
  const target = line - 1;
  for (let n = target; n >= 0; n--) {
    const text = rows[n] ?? "";
    if (name) {
      const patterns = [
        new RegExp(`\\bfunction\\s+${escapeRegExp(name)}\\b`),
        new RegExp(`\\bexport\\s+(?:async\\s+)?function\\s+${escapeRegExp(name)}\\b`),
        new RegExp(`\\b${escapeRegExp(name)}\\s*=\\s*(?:async\\s*)?(?:function\\b|\\()`),
      ];
      if (patterns.some((re) => re.test(text))) return n;
      continue;
    }
    if (/^\s*export\s+(?:async\s+)?function\s+\w+/.test(text)) return n;
    if (/^\s*(?:async\s+)?function\s+\w+/.test(text)) return n;
    if (/^\s*(?:export\s+)?(?:const|let|var)\s+\w+\s*=/.test(text) && /=>|function/.test(text)) return n;
  }
  return null;
}

export function buildOriginFrameLines(text: string, line: number, name?: string): OriginDisplayLine[] {
  const rows = text.split("\n");
  const target = line - 1;
  const headerIdx = findFunctionHeaderRow(rows, line, name);
  const from = Math.max(0, target - 1);
  const to = Math.min(rows.length, target + 2);
  const out: OriginDisplayLine[] = [];

  if (headerIdx != null) {
    out.push({ kind: "header", line: headerIdx + 1, text: rows[headerIdx] ?? "" });
    if (from > headerIdx + 1) out.push({ kind: "ellipsis" });
  }

  for (let n = from; n < to; n++) {
    if (headerIdx != null && n === headerIdx) continue;
    out.push({ kind: "code", line: n + 1, text: rows[n] ?? "", current: n === target });
  }

  return out.length > 0
    ? out
    : [{ kind: "code", line, text: rows[target] ?? "", current: true }];
}

export async function peekFile(
  cache: Map<string, string>,
  file: string,
  module?: string,
): Promise<string> {
  const key = normalizeSceneRelPath(file, module);
  const cached = cache.get(key);
  if (cached != null) return cached;
  const res = await fetch(`/__peek?file=${encodeURIComponent(key)}`);
  if (!res.ok) throw new Error(`Could not read ${key}`);
  const text = await res.text();
  cache.set(key, text);
  return text;
}

export async function originFromStack(
  frames: readonly CallSite[],
  cache: Map<string, string>,
  module?: string,
): Promise<OriginView> {
  if (frames.length === 0) {
    return { kind: "empty", message: "No source location for this object." };
  }

  const originFrames: OriginFrame[] = [];
  for (const frame of frames) {
    if (!isUserSourcePath(frame.file)) continue;
    try {
      const text = await peekFile(cache, frame.file, module);
      originFrames.push({
        file: fileName(frame.file),
        lines: buildOriginFrameLines(text, frame.line, frame.name),
      });
    } catch (err) {
      return {
        kind: "empty",
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  if (originFrames.length === 0) {
    return { kind: "empty", message: "No peekable source for this object." };
  }

  return { kind: "origin", frames: originFrames };
}

export function stackForNode(node: TraceNode): CallSite[] {
  const site =
    node.at && node.module
      ? { file: node.module, line: node.at.line, column: node.at.column }
      : undefined;
  const module = node.module?.replace(/^\/+/, "");
  const fromStack = node.stack
    .filter((f) => isUserSourcePath(f.file))
    .map((f) => ({
      ...f,
      file: normalizeSceneRelPath(f.file, module),
    }));
  if (site) return pinConstructorSite(fromStack, site);
  return fromStack;
}

function selectionMeta(node: TraceNode): string {
  const stack = pinConstructorSite(
    stackForNode(node),
    node.at && node.module
      ? { file: node.module, line: node.at.line, column: node.at.column }
      : undefined,
  );
  const label = stackLabel(stack);
  if (label) return label;
  if (node.at && node.module) return `${node.module}:${node.at.line}:${node.at.column}`;
  return `${node.kind} · occ ${node.occ}`;
}

function selectionCrumb(node: TraceNode): string {
  if (node.bind) return node.bind;
  if (node.occ > 0) return `${node.id} #${node.occ}`;
  return node.id || node.kind;
}

export async function selectionDetailForNode(
  node: TraceNode,
  cache: Map<string, string>,
): Promise<SelectionDetail> {
  const stack = stackForNode(node);
  return {
    crumb: selectionCrumb(node),
    meta: selectionMeta(node),
    origin: await originFromStack(stack, cache, node.module),
  };
}
