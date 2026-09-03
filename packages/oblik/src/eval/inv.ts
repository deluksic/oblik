import type { MentionFile, MentionFn } from "../source/mention";
import type { TraceInv, TraceNode } from "./context";
import {
  normalizeCallSite,
  sourceFileKey,
  stackFileKey,
  userStackFrames,
  type CallSite,
} from "./stack";

export type { TraceInv } from "./context";

export function invKey(inv: TraceInv): string {
  return `${sourceFileKey(inv.file)}\0${inv.name ?? ""}\0${sourceFileKey(inv.callerFile)}\0${inv.callerLine}\0${inv.callerColumn}\0${inv.serial}`;
}

function sameSourceFile(a: string, b: string): boolean {
  return sourceFileKey(a) === sourceFileKey(b);
}

function sameStackFile(a: string, b: string): boolean {
  return stackFileKey(a) === stackFileKey(b);
}

function fnContaining(
  files: readonly MentionFile[],
  file: string | undefined,
  line: number | undefined,
): MentionFn | undefined {
  if (!file || line == null) return undefined;
  const bundle = files.find((f) => sameSourceFile(f.file, file) || sameStackFile(f.file, file));
  if (!bundle) return undefined;
  let best: MentionFn | undefined;
  for (const fn of bundle.functions) {
    if (line < fn.startLine || line > fn.endLine) continue;
    if (!best || fn.end - fn.start < best.end - fn.start) best = fn;
  }
  return best;
}

function fnForNode(n: TraceNode, files: readonly MentionFile[]): MentionFn | undefined {
  const fromAnno = fnContaining(files, n.module, n.at?.line);
  if (fromAnno) return fromAnno;
  const leaf = userStackFrames(n.stack)[0];
  return fnContaining(files, leaf?.file, leaf?.line);
}

function callerOf(n: TraceNode, fn: MentionFn): CallSite {
  const frames = userStackFrames(n.stack);
  const inSpan = (f: CallSite) =>
    sameStackFile(f.file, fn.file) && f.line >= fn.startLine && f.line <= fn.endLine;
  const anyInSpan = frames.some(inSpan);
  for (const f of frames) {
    if (anyInSpan) {
      if (inSpan(f)) continue;
    } else if (sameStackFile(f.file, fn.file)) {
      // Generated stacks may not land in the source span. Same-file frames are
      // still this function; the caller is the first frame in another file.
      continue;
    }
    return normalizeCallSite(f);
  }
  return { file: "", line: 0, column: 0 };
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

/** Stamp `n.inv` from mention functions + stacks. Mutates `trace`. */
export function assignInv(trace: TraceNode[], files: readonly MentionFile[]): TraceNode[] {
  const groups = new Map<string, Group>();
  for (const n of trace) {
    const fn = fnForNode(n, files);
    if (!fn) continue;
    const caller = callerOf(n, fn);
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
  if (focus.name != null && inv.name !== focus.name) return false;
  if (focus.serial != null && inv.serial !== focus.serial) return false;
  if (focus.callerFile != null && sourceFileKey(inv.callerFile) !== sourceFileKey(focus.callerFile))
    return false;
  if (focus.callerLine != null && inv.callerLine !== focus.callerLine) return false;
  return true;
}
