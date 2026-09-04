import type { MentionFile, MentionFn } from "../source/mention";
import type { TraceInv, TraceNode } from "./context";
import { normalizeCallSite, normalizeStackFile, sourceFileKey, type CallSite } from "./stack";

export type { TraceInv } from "./context";

export function invKey(inv: TraceInv): string {
  return `${sourceFileKey(inv.file)}\0${inv.name ?? ""}\0${sourceFileKey(inv.callerFile)}\0${inv.callerLine}\0${inv.callerColumn}\0${inv.serial}`;
}

const EMPTY_CALLER: CallSite = { file: "", line: 0, column: 0 };

type MentionIndex = {
  bySourceKey: Map<string, MentionFile>;
  byStackKey: Map<string, MentionFile>;
};

type InvCtx = {
  index: MentionIndex;
  norm: Map<string, string>;
};

function buildMentionIndex(files: readonly MentionFile[], norm: Map<string, string>): MentionIndex {
  const bySourceKey = new Map<string, MentionFile>();
  const byStackKey = new Map<string, MentionFile>();
  for (const bundle of files) {
    bySourceKey.set(sourceFileKey(bundle.file), bundle);
    byStackKey.set(stackKey(norm, bundle.file), bundle);
  }
  return { bySourceKey, byStackKey };
}

function stackKey(norm: Map<string, string>, file: string): string {
  return sourceFileKey(normalizedPath(norm, file));
}

function normalizedPath(norm: Map<string, string>, file: string): string {
  let path = norm.get(file);
  if (path === undefined) {
    path = normalizeStackFile(file);
    norm.set(file, path);
  }
  return path;
}

function bundleFor(ctx: InvCtx, file: string): MentionFile | undefined {
  return (
    ctx.index.bySourceKey.get(sourceFileKey(file)) ??
    ctx.index.byStackKey.get(stackKey(ctx.norm, file))
  );
}

function fnContaining(
  ctx: InvCtx,
  file: string | undefined,
  line: number | undefined,
): MentionFn | undefined {
  if (!file || line === undefined) return undefined;
  const bundle = bundleFor(ctx, file);
  if (!bundle) return undefined;
  let best: MentionFn | undefined;
  for (const fn of bundle.functions) {
    if (line < fn.startLine || line > fn.endLine) continue;
    if (!best || fn.end - fn.start < best.end - fn.start) best = fn;
  }
  return best;
}

function userFrames(ctx: InvCtx, frames: readonly CallSite[]): CallSite[] {
  const out: CallSite[] = [];
  for (const f of frames) {
    if (!isUserSourcePathCached(ctx, f.file)) continue;
    out.push(f);
  }
  return out;
}

function isUserSourcePathCached(ctx: InvCtx, file: string): boolean {
  if (!file) return false;
  if (file.includes("node_modules")) return false;
  if (file.includes("/.vite/") || file.startsWith(".vite/")) return false;
  if (file.includes("/oblik/") || file.includes("packages/oblik")) return false;
  if (file.startsWith("node:")) return false;
  const key = normalizedPath(ctx.norm, file);
  if (key.includes("node_modules")) return false;
  if (key.includes("/.vite/") || key.startsWith(".vite/")) return false;
  if (key.startsWith("node:")) return false;
  if (key.includes("/oblik/")) return false;
  return key.endsWith(".ts") || key.endsWith(".tsx");
}

function sameStackFile(ctx: InvCtx, a: string, b: string): boolean {
  return stackKey(ctx.norm, a) === stackKey(ctx.norm, b);
}

function fnForNode(ctx: InvCtx, n: TraceNode, frames: CallSite[]): MentionFn | undefined {
  const fromAnno = fnContaining(ctx, n.module, n.at?.line);
  if (fromAnno) return fromAnno;
  const leaf = frames[0];
  return fnContaining(ctx, leaf?.file, leaf?.line);
}

function callerOf(ctx: InvCtx, frames: readonly CallSite[], fn: MentionFn): CallSite {
  const inSpan = (f: CallSite) =>
    sameStackFile(ctx, f.file, fn.file) && f.line >= fn.startLine && f.line <= fn.endLine;
  const anyInSpan = frames.some(inSpan);
  for (const f of frames) {
    if (anyInSpan) {
      if (inSpan(f)) continue;
    } else if (sameStackFile(ctx, f.file, fn.file)) {
      // Generated stacks may not land in the source span. Same-file frames are
      // still this function; the caller is the first frame in another file.
      continue;
    }
    return normalizeCallSite(f);
  }
  return EMPTY_CALLER;
}

type Group = { fn: MentionFn; caller: CallSite; nodes: TraceNode[] };

function groupKey(fn: MentionFn, caller: CallSite): string {
  return `${sourceFileKey(fn.file)}\0${fn.start}\0${sourceFileKey(caller.file)}\0${caller.line}\0${caller.column}`;
}

function stampGroup(fn: MentionFn, caller: CallSite, nodes: TraceNode[]): void {
  const once = new Set(fn.onceIds);
  const anchors = nodes.filter((n) => once.has(n.id));
  const assign = (n: TraceNode, serial: number) => {
    n.inv = {
      file: fn.file,
      name: fn.name,
      callerFile: caller.file,
      callerLine: caller.line,
      callerColumn: caller.column,
      serial,
    };
  };
  if (anchors.length === 0) {
    for (const n of nodes) assign(n, 0);
    return;
  }
  const firstAnchorAt = nodes.indexOf(anchors[0]!);
  const prefix = firstAnchorAt > 0 && nodes.slice(0, firstAnchorAt).some((n) => !once.has(n.id));
  if (prefix) {
    const lastAt = new Map<number, number>();
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i]!;
      if (!once.has(n.id)) continue;
      lastAt.set(n.occ, i);
    }
    let prev = -1;
    const occs = [...lastAt.keys()].toSorted((a, b) => a - b);
    for (const occ of occs) {
      const end = lastAt.get(occ)!;
      for (let i = prev + 1; i <= end; i++) assign(nodes[i]!, occ);
      prev = end;
    }
    for (let i = prev + 1; i < nodes.length; i++) assign(nodes[i]!, occs[occs.length - 1] ?? 0);
    return;
  }
  const firstAt = new Map<number, number>();
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]!;
    if (!once.has(n.id)) continue;
    if (!firstAt.has(n.occ)) firstAt.set(n.occ, i);
  }
  const occs = [...firstAt.keys()].toSorted((a, b) => a - b);
  for (let k = 0; k < occs.length; k++) {
    const occ = occs[k]!;
    const start = firstAt.get(occ)!;
    const end = k + 1 < occs.length ? firstAt.get(occs[k + 1]!)! : nodes.length;
    for (let i = start; i < end; i++) assign(nodes[i]!, occ);
  }
}

/** True when helper calls or repeated invocations need stack-based caller/serial grouping. */
export function mentionsNeedStackInv(files: readonly MentionFile[]): boolean {
  if (files.length !== 1) return true;
  const fns = files[0]!.functions;
  if (fns.length !== 1) return true;
  const only = fns[0]!;
  if (only.calls.length > 0) return true;
  if (only.onceIds.length !== only.ids.length) return true;
  return (only.name ?? "build") !== "build";
}

function assignInvFlat(trace: TraceNode[], ctx: InvCtx): void {
  for (const n of trace) {
    const fn = fnContaining(ctx, n.module, n.at?.line);
    if (!fn) continue;
    n.inv = {
      file: fn.file,
      name: fn.name,
      callerFile: EMPTY_CALLER.file,
      callerLine: 0,
      callerColumn: 0,
      serial: 0,
    };
  }
}

/** Stamp `n.inv` from mention functions + stacks. Mutates `trace`. */
export function assignInv(trace: TraceNode[], files: readonly MentionFile[]): TraceNode[] {
  const norm = new Map<string, string>();
  const ctx: InvCtx = { index: buildMentionIndex(files, norm), norm };
  if (!mentionsNeedStackInv(files)) {
    assignInvFlat(trace, ctx);
    return trace;
  }
  const groups = new Map<string, Group>();
  for (const n of trace) {
    const frames = userFrames(ctx, n.stack);
    const fn = fnForNode(ctx, n, frames);
    if (!fn) continue;
    const caller = callerOf(ctx, frames, fn);
    const key = groupKey(fn, caller);
    let g = groups.get(key);
    if (!g) {
      g = { fn, caller, nodes: [] };
      groups.set(key, g);
    }
    g.nodes.push(n);
  }
  for (const g of groups.values()) stampGroup(g.fn, g.caller, g.nodes);
  return trace;
}

export function invMatches(
  n: TraceNode,
  focus: { file: string; name?: string; serial?: number; callerFile?: string; callerLine?: number },
): boolean {
  const inv = n.inv;
  if (!inv) return false;
  if (sourceFileKey(inv.file) !== sourceFileKey(focus.file)) return false;
  if (focus.name !== undefined && inv.name !== focus.name) return false;
  if (focus.serial !== undefined && inv.serial !== focus.serial) return false;
  if (
    focus.callerFile !== undefined &&
    sourceFileKey(inv.callerFile) !== sourceFileKey(focus.callerFile)
  )
    return false;
  if (focus.callerLine !== undefined && inv.callerLine !== focus.callerLine) return false;
  return true;
}
