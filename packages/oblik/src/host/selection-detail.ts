import type { TraceNode } from "../eval/context";
import { invMatches } from "../eval/inv";
import type { CallSite } from "../eval/stack";
import {
  isUserSourcePath,
  normalizeStackFile,
  sourceFileKey,
  userStackFrames,
} from "../eval/stack";
import type { MentionFile, MentionFn } from "../source/mention";
import { normalizeSceneRelPath } from "../source/scene-path";

export type OriginCodeLine = {
  kind: "code";
  line: number;
  text: string;
  current?: boolean;
};

export type OriginDisplayLine =
  | OriginCodeLine
  | { kind: "header"; line: number; text: string; current?: boolean }
  | { kind: "ellipsis" };

export type SelectionDetail = {
  crumb: string;
  meta: string;
  origin: OriginView;
  focus?: ScopePick;
  expose?: ExposeNote;
};

export type ScopePick = {
  file: string;
  name?: string;
  serial?: number;
  callerFile?: string;
  callerLine?: number;
};

export type ExposeNote = {
  kind: "hint" | "blocked";
  text: string;
  bind?: string;
};

export type OriginFrame = {
  file: string;
  lines: OriginDisplayLine[];
  pick?: ScopePick;
  current?: boolean;
};

export type OriginView =
  | { kind: "empty"; message: string }
  | { kind: "origin"; frames: OriginFrame[] };

export const EMPTY_SELECTION_DETAIL: SelectionDetail = {
  crumb: "Nothing selected",
  meta: "Current scope, no geometry.",
  origin: {
    kind: "empty",
    message: "Current scope, no geometry selected. Click a helper on the tape to dive.",
  },
};

function fileName(file: string): string {
  return file.split("/").pop() ?? file;
}

/** Path shown in origin / stack labels — `src/layout/foo.ts`, not a colliding basename. */
export function originFileLabel(file: string): string {
  const key = file.replace(/^\/+/, "").replace(/\?.*$/, "");
  const src = key.indexOf("src/");
  if (src >= 0) return key.slice(src);
  return fileName(key);
}

function frameWho(f: CallSite): string {
  const named = f.name?.trim();
  if (named) return named;
  return fileName(f.file).replace(/\.(scene\.)?tsx?$/, "");
}

/** Normalize raw capture-time stack frames for display and peek. */
function presentStack(frames: readonly CallSite[], module?: string): CallSite[] {
  return userStackFrames(frames).map((f) => ({
    ...f,
    file: normalizeSceneRelPath(normalizeStackFile(f.file), module),
  }));
}

export function stackLabel(frames: readonly CallSite[]): string {
  if (frames.length === 0) return "";
  const leaf = frames[0]!;
  const who = frameWho(leaf);
  const file = originFileLabel(leaf.file);
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

export function findFunctionHeaderRow(
  rows: readonly string[],
  line: number,
  name?: string,
): number | null {
  const target = Math.min(Math.max(line - 1, 0), Math.max(0, rows.length - 1));
  for (let n = target; n >= 0; n--) {
    if (rowLooksLikeFunctionHeader(rows[n] ?? "", name)) return n;
  }
  if (name) {
    for (let n = 0; n < rows.length; n++) {
      if (rowLooksLikeFunctionHeader(rows[n] ?? "", name)) return n;
    }
  }
  return null;
}

function rowLooksLikeFunctionHeader(text: string, name?: string): boolean {
  if (name) {
    const patterns = [
      new RegExp(`\\bfunction\\s+${escapeRegExp(name)}\\b`),
      new RegExp(`\\bexport\\s+(?:async\\s+)?function\\s+${escapeRegExp(name)}\\b`),
      new RegExp(`\\b${escapeRegExp(name)}\\s*=\\s*(?:async\\s*)?(?:function\\b|\\()`),
      // Method shorthand: `build() {` inside defineScene({ … }).
      new RegExp(`\\b${escapeRegExp(name)}\\s*\\([^\\n;]*\\)\\s*(?::[^{\\n]+)?\\{`),
    ];
    return patterns.some((re) => re.test(text));
  }
  if (/^\s*export\s+(?:async\s+)?function\s+\w+/.test(text)) return true;
  if (/^\s*(?:async\s+)?function\s+\w+/.test(text)) return true;
  if (/^\s*(?:export\s+)?(?:const|let|var)\s+\w+\s*=/.test(text) && /=>|function/.test(text))
    return true;
  return false;
}

/** A line that is only a function/object closer — stacks often land here. */
export function isClosingBraceLine(text: string): boolean {
  return /^\s*\}[),;]*\s*$/.test(text);
}

function leadingIndent(text: string): string {
  const match = /^[\t ]*/.exec(text);
  return match?.[0] ?? "";
}

function indentColumns(indent: string): number {
  let cols = 0;
  for (const ch of indent) cols += ch === "\t" ? 2 : 1;
  return cols;
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) {
    const next = x % y;
    x = y;
    y = next;
  }
  return x;
}

function commonLeadingIndent(texts: readonly string[]): string {
  const indents = texts.filter((row) => row.trim() !== "").map(leadingIndent);
  if (indents.length === 0) return "";
  let prefix = indents[0]!;
  for (const indent of indents.slice(1)) {
    let n = 0;
    while (n < prefix.length && n < indent.length && prefix[n] === indent[n]) n += 1;
    prefix = prefix.slice(0, n);
    if (prefix.length === 0) return "";
  }
  return prefix;
}

function stripCommonIndent(text: string, prefix: string): string {
  if (prefix && text.startsWith(prefix)) return text.slice(prefix.length);
  if (text.trim() === "") return "";
  return text;
}

function twoSpaceIndent(text: string, unit: number): string {
  if (text.trim() === "") return "";
  const indent = leadingIndent(text);
  const rest = text.slice(indent.length);
  const cols = indentColumns(indent);
  if (cols === 0) return rest;
  const levels = unit >= 2 ? Math.round(cols / unit) : cols;
  return `${"  ".repeat(levels)}${rest}`;
}

function originIndentUnit(texts: readonly string[]): number {
  const widths = texts
    .filter((row) => row.trim() !== "")
    .map((row) => indentColumns(leadingIndent(row)))
    .filter((cols) => cols > 0);
  if (widths.length === 0) return 2;
  const unit = widths.reduce((a, b) => gcd(a, b));
  return unit >= 2 ? unit : 2;
}

/** Strip shared indent, then rewrite remaining indent as 2 spaces per level. */
export function dedentOriginLines(lines: OriginDisplayLine[]): OriginDisplayLine[] {
  const texts = lines.flatMap((row) => ("text" in row ? [row.text] : []));
  const prefix = commonLeadingIndent(texts);
  const stripped = texts.map((text) => stripCommonIndent(text, prefix));
  const unit = originIndentUnit(stripped);
  let i = 0;
  return lines.map((row) => {
    if (!("text" in row)) return row;
    const text = twoSpaceIndent(stripped[i++] ?? "", unit);
    return text === row.text ? row : { ...row, text };
  });
}

function scanFunctionEnd(rows: readonly string[], headerIdx: number): number {
  let depth = 0;
  let started = false;
  for (let n = headerIdx; n < rows.length; n++) {
    const row = rows[n] ?? "";
    for (let i = 0; i < row.length; i++) {
      const ch = row[i];
      if (ch === "{") {
        depth += 1;
        started = true;
      } else if (ch === "}") {
        depth -= 1;
      }
    }
    if (started && depth <= 0) return n + 1;
  }
  return rows.length;
}

export function buildOriginFrameLines(
  text: string,
  line: number,
  name?: string,
): OriginDisplayLine[] {
  const rows = text.split("\n");
  const headerIdx = findFunctionHeaderRow(rows, line, name);
  let target = Math.min(Math.max(line - 1, 0), Math.max(0, rows.length - 1));
  const pinOnHeader = headerIdx != null && isClosingBraceLine(rows[target] ?? "");
  if (pinOnHeader) target = headerIdx;
  const bodyStart = headerIdx != null ? headerIdx + 1 : 0;
  const from = Math.max(bodyStart, target - 1);
  const to = Math.min(rows.length, Math.max(from, target) + 2);
  const out: OriginDisplayLine[] = [];

  if (headerIdx != null) {
    out.push({
      kind: "header",
      line: headerIdx + 1,
      text: rows[headerIdx] ?? "",
      current: target === headerIdx,
    });
    if (from > headerIdx + 1) out.push({ kind: "ellipsis" });
  }

  for (let n = from; n < to; n++) {
    if (headerIdx != null && n === headerIdx) continue;
    out.push({ kind: "code", line: n + 1, text: rows[n] ?? "", current: n === target });
  }

  return dedentOriginLines(
    out.length > 0
      ? out
      : [{ kind: "code", line: target + 1, text: rows[target] ?? "", current: true }],
  );
}

/** Inclusive 1-based span of a function body, for empty-selection origin. */
export function functionSourceSpan(
  text: string,
  opts: { startLine?: number; endLine?: number; name?: string },
): { startLine: number; endLine: number } {
  const rows = text.split("\n");
  const hint = opts.startLine ?? opts.endLine ?? 1;
  let headerIdx = findFunctionHeaderRow(rows, hint, opts.name);
  if (headerIdx == null && opts.endLine != null && opts.endLine !== hint) {
    headerIdx = findFunctionHeaderRow(rows, opts.endLine, opts.name);
  }
  if (headerIdx == null) {
    if (
      opts.startLine != null &&
      opts.endLine != null &&
      opts.endLine >= opts.startLine &&
      !isClosingBraceLine(rows[opts.startLine - 1] ?? "")
    ) {
      return { startLine: opts.startLine, endLine: opts.endLine };
    }
    return { startLine: hint, endLine: hint };
  }
  const startLine = headerIdx + 1;
  if (opts.endLine != null && opts.endLine >= startLine) {
    return { startLine, endLine: opts.endLine };
  }
  return { startLine, endLine: scanFunctionEnd(rows, headerIdx) };
}

/** Full function source — header + every remaining line, no ellipsis. Pin is the opening. */
export function buildFunctionSourceLines(
  text: string,
  span: { startLine: number; endLine: number },
): OriginDisplayLine[] {
  const rows = text.split("\n");
  const from = Math.max(0, span.startLine - 1);
  const to = Math.min(rows.length, Math.max(from + 1, span.endLine));
  const out: OriginDisplayLine[] = [];
  for (let n = from; n < to; n++) {
    const line = n + 1;
    const raw = rows[n] ?? "";
    if (n === from) out.push({ kind: "header", line, text: raw, current: true });
    else out.push({ kind: "code", line, text: raw });
  }
  return dedentOriginLines(
    out.length > 0 ? out : [{ kind: "header", line: span.startLine, text: "", current: true }],
  );
}

export async function peekFile(
  cache: Map<string, string>,
  file: string,
  module?: string,
): Promise<string> {
  const keys = [
    ...new Set([
      normalizeSceneRelPath(file, module),
      file.replace(/^\/+/, "").replace(/\?.*$/, ""),
    ]),
  ];
  for (const key of keys) {
    const cached = cache.get(key);
    if (cached != null) return cached;
  }
  let lastErr: Error | undefined;
  for (const key of keys) {
    try {
      const res = await fetch(`/__peek?file=${encodeURIComponent(key)}`);
      if (!res.ok) {
        lastErr = new Error(`Could not read ${key}`);
        continue;
      }
      const text = await res.text();
      cache.set(key, text);
      return text;
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw lastErr ?? new Error(`Could not read ${file}`);
}

export async function mapStack(frames: readonly CallSite[]): Promise<CallSite[]> {
  if (frames.length === 0) return [];
  try {
    const res = await fetch("/__map-stack", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ frames }),
    });
    if (!res.ok) return frames.map((f) => ({ ...f }));
    const body = (await res.json()) as { frames?: CallSite[] };
    return Array.isArray(body.frames) ? body.frames : frames.map((f) => ({ ...f }));
  } catch {
    return frames.map((f) => ({ ...f }));
  }
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
        file: originFileLabel(frame.file),
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
  const fromStack = presentStack(node.stack, module);
  if (site) return pinConstructorSite(fromStack, site);
  return fromStack;
}

function constructorSite(
  node: TraceNode,
): { file: string; line: number; column: number } | undefined {
  if (!node.at || !node.module) return undefined;
  return { file: node.module, line: node.at.line, column: node.at.column };
}

function selectionMeta(stack: readonly CallSite[], node: TraceNode): string {
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

export async function selectionDetailForNode(node: TraceNode): Promise<SelectionDetail> {
  const runtime = presentStack(node.stack, node.module);
  const mapped = await mapStack(runtime);
  const stack = pinConstructorSite(mapped, constructorSite(node));
  const cache = new Map<string, string>();
  const origin = await originFromStack(stack, cache, node.module);
  return {
    crumb: selectionCrumb(node),
    meta: selectionMeta(stack, node),
    origin,
  };
}

function fnAtLine(
  mentions: readonly MentionFile[],
  file: string,
  line: number,
): MentionFn | undefined {
  const key = sourceFileKey(file);
  let best: MentionFn | undefined;
  for (const bundle of mentions) {
    for (const fn of bundle.functions) {
      if (sourceFileKey(fn.file) !== key && sourceFileKey(bundle.file) !== key) continue;
      if (line < fn.startLine || line > fn.endLine) continue;
      if (!best || fn.end - fn.start < best.end - fn.start) best = fn;
    }
  }
  return best;
}

function sameFocus(a: ScopePick, b: ScopePick): boolean {
  if (sourceFileKey(a.file) !== sourceFileKey(b.file)) return false;
  if ((a.name ?? "") !== (b.name ?? "")) return false;
  if (a.serial != null && b.serial != null && a.serial !== b.serial) return false;
  return true;
}

function callerFromMentions(
  focus: ScopePick,
  mentions: readonly MentionFile[],
): { file: string; line: number; name?: string } | undefined {
  if (!focus.name) return undefined;
  const hits: { file: string; line: number; name?: string }[] = [];
  for (const bundle of mentions) {
    for (const fn of bundle.functions) {
      if (fn.name === focus.name && sourceFileKey(fn.file) === sourceFileKey(focus.file)) continue;
      for (const call of fn.calls) {
        if (call.callee !== focus.name) continue;
        hits.push({ file: fn.file, line: call.line, name: fn.name });
      }
    }
  }
  if (hits.length === 0) return undefined;
  if (focus.callerLine != null) {
    const hit = hits.find(
      (h) =>
        h.line === focus.callerLine &&
        (focus.callerFile == null || sourceFileKey(h.file) === sourceFileKey(focus.callerFile)),
    );
    if (hit) return hit;
  }
  if (focus.callerFile) {
    const callerFile = focus.callerFile;
    const inFile = hits.find((h) => sourceFileKey(h.file) === sourceFileKey(callerFile));
    if (inFile) return inFile;
  }
  return hits[0];
}

function callerSiteOf(
  focus: ScopePick,
  mentions: readonly MentionFile[],
  trace: readonly TraceNode[],
): { file: string; line: number; name?: string } | undefined {
  // Mentions know the call expression. Runtime stacks often land on `build() {`
  // or the closing `}` of the caller instead of the helper invocation.
  const fromMentions = callerFromMentions(focus, mentions);
  if (fromMentions) return fromMentions;
  if (focus.callerFile && focus.callerLine && focus.callerLine > 0) {
    return { file: focus.callerFile, line: focus.callerLine };
  }
  const n = trace.find((node) =>
    node.inv
      ? invMatches(node, {
          file: focus.file,
          name: focus.name,
          serial: focus.serial,
          callerFile: focus.callerFile,
          callerLine: focus.callerLine,
        })
      : false,
  );
  if (n?.inv?.callerFile && n.inv.callerLine > 0) {
    return { file: n.inv.callerFile, line: n.inv.callerLine };
  }
  return undefined;
}

/** Caller scopes above `focus`, leaf-parent first — same order as a selected node's origin stack. */
export function scopeCallerChain(
  focus: ScopePick,
  mentions: readonly MentionFile[],
  trace: readonly TraceNode[] = [],
): Array<{ pick: ScopePick; file: string; line: number; name?: string }> {
  const out: Array<{ pick: ScopePick; file: string; line: number; name?: string }> = [];
  const seen = new Set<string>();
  let cur = focus;
  for (let i = 0; i < 8; i++) {
    const id = `${sourceFileKey(cur.file)}\0${cur.name ?? ""}\0${cur.serial ?? ""}`;
    if (seen.has(id)) break;
    seen.add(id);
    const site = callerSiteOf(cur, mentions, trace);
    if (!site?.file || site.line <= 0) break;
    const fn = fnAtLine(mentions, site.file, site.line);
    const parentNode = trace.find(
      (n) =>
        !!n.inv &&
        !!fn &&
        n.inv.name === fn.name &&
        sourceFileKey(n.inv.file) === sourceFileKey(fn.file),
    );
    const pick: ScopePick = fn
      ? {
          file: fn.file,
          name: fn.name,
          serial: parentNode?.inv?.serial ?? 0,
          callerFile: parentNode?.inv?.callerFile || undefined,
          callerLine: parentNode?.inv?.callerLine || undefined,
        }
      : { file: site.file, name: site.name, serial: 0 };
    if (sameFocus(pick, cur)) break;
    out.push({ pick, file: site.file, line: site.line, name: fn?.name ?? site.name });
    cur = pick;
  }
  return out;
}

function exposeNote(fn: MentionFn | undefined, node: TraceNode): ExposeNote | undefined {
  if (!fn || !fn.ids.includes(node.id)) return undefined;
  if (fn.return.kind === "bag" && fn.return.fields.some((f) => f.id === node.id)) return undefined;
  if (fn.return.kind === "value" && fn.return.id === node.id) return undefined;
  if (fn.return.kind === "value" || fn.return.kind === "other") {
    return {
      kind: "blocked",
      text: "This function returns a single value, so it has no return bag to add a field to. Change the return to an object literal first — oblik will not wrap it.",
    };
  }
  const bind = node.bind;
  if (!bind || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(bind)) return undefined;
  return {
    kind: "hint",
    bind,
    text: `${bind} is constructed here and not returned. Add it to the return so the caller can refer to it.`,
  };
}

export function emptyScopeDetail(focus: ScopePick): SelectionDetail {
  const who = focus.name ?? "scope";
  return {
    crumb: who,
    meta: originFileLabel(focus.file),
    origin: {
      kind: "empty",
      message:
        "Current scope, no geometry selected. Click a helper on the tape or a parent frame to change scope.",
    },
    focus,
  };
}

export async function selectionDetailForScope(opts: {
  node: TraceNode | null;
  focus: ScopePick;
  mentions: readonly MentionFile[];
  print?: string;
  trace?: readonly TraceNode[];
}): Promise<SelectionDetail> {
  const { node, focus, mentions, print, trace = [] } = opts;
  if (!node) {
    const detail = emptyScopeDetail(focus);
    try {
      const cache = new Map<string, string>();
      const text = await peekFile(cache, focus.file);
      const fn = focus.name
        ? mentions
            .flatMap((m) => m.functions)
            .find(
              (f) => f.name === focus.name && sourceFileKey(f.file) === sourceFileKey(focus.file),
            )
        : undefined;
      const span = functionSourceSpan(text, {
        startLine: fn?.startLine,
        endLine: fn?.endLine,
        name: focus.name,
      });
      const frames: OriginFrame[] = [
        {
          file: originFileLabel(focus.file),
          lines: buildFunctionSourceLines(text, span),
          pick: focus,
          current: true,
        },
      ];
      for (const ancestor of scopeCallerChain(focus, mentions, trace)) {
        try {
          const parentText = await peekFile(cache, ancestor.file);
          frames.push({
            file: originFileLabel(ancestor.file),
            lines: buildOriginFrameLines(parentText, ancestor.line, ancestor.name),
            pick: ancestor.pick,
            current: false,
          });
        } catch {
          /* parent peek is optional — still show the focused function */
        }
      }
      return {
        ...detail,
        origin: { kind: "origin", frames },
      };
    } catch {
      return detail;
    }
  }

  const base = await selectionDetailForNode(node);
  const runtime = presentStack(node.stack, node.module);
  const mapped = await mapStack(runtime);
  const stack = pinConstructorSite(mapped, constructorSite(node));
  let origin = base.origin;
  if (origin.kind === "origin") {
    origin = {
      kind: "origin",
      frames: origin.frames.map((frame, i) => {
        const site = stack[i];
        const fn = site ? fnAtLine(mentions, site.file, site.line) : undefined;
        const pick: ScopePick =
          i === 0 && node.inv
            ? {
                file: node.inv.file,
                name: node.inv.name,
                serial: node.inv.serial,
                callerFile: node.inv.callerFile,
                callerLine: node.inv.callerLine,
              }
            : fn
              ? { file: fn.file, name: fn.name, serial: 0 }
              : { file: site?.file ?? focus.file, name: site?.name ?? focus.name, serial: 0 };
        return { ...frame, pick, current: sameFocus(pick, focus) };
      }),
    };
  }
  const focusedFn = focus.name
    ? mentions
        .flatMap((m) => m.functions)
        .find((f) => f.name === focus.name && sourceFileKey(f.file) === sourceFileKey(focus.file))
    : undefined;
  return {
    ...base,
    crumb: print ?? selectionCrumb(node),
    origin,
    focus,
    expose: exposeNote(focusedFn, node),
  };
}
