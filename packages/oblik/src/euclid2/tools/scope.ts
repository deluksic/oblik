import type { TraceNode } from "@/eval/context";
import { invMatches, type TraceInv } from "@/eval/inv";
import { sourceFileKey } from "@/eval/stack";
import type { Circle, LineLike, Profile } from "@/geom";
import { gliderAt, isGlider } from "@/geom/gliders";
import { member, printExpr, type Expr } from "@/source/expr";
import { fnNamed, insertPointNames, type MentionFile, type MentionFn } from "@/source/mention";
import { isFiniteTrace, traceKey, type SnapFilter } from "../pick";
import type { Placed, Scope } from "./types";

export const EMPTY_SCOPE: Scope = {
  used: [],
  points: {},
  carriers: {},
  circles: {},
  profiles: {},
  lengths: {},
  byId: {},
  prints: {},
};

export type ScopeFocus = {
  file: string;
  name?: string;
  serial?: number;
  callerFile?: string;
  callerLine?: number;
};

function findFn(mentions: readonly MentionFile[], focus: ScopeFocus): MentionFn | undefined {
  const want = sourceFileKey(focus.file);
  if (focus.name) {
    const inFile = mentions.filter((f) => sourceFileKey(f.file) === want);
    for (const f of inFile) {
      const fn = fnNamed(f, focus.name);
      if (fn) return fn;
    }
    for (const f of mentions) {
      const fn = fnNamed(f, focus.name);
      if (fn) return fn;
    }
    // Named miss: do not pick some other function in the file. Unknown
    // callees (`fillet`, `along`) are not helpers; treating them as this
    // function would add every sibling invocation to liveKeys.
    return undefined;
  }
  return mentions.flatMap((m) => m.functions).find((f) => sourceFileKey(f.file) === want);
}

function reverseBind(fn: MentionFn, id: string): string | undefined {
  const local = insertPointNames(fn);
  for (const [bind, bindId] of Object.entries(fn.bindToId)) {
    if (bindId === id && local.has(bind)) return bind;
  }
}

function childNodes(
  trace: readonly TraceNode[],
  callee: MentionFn,
  call: { line: number; column: number; callee: string },
  caller: MentionFn,
): TraceNode[] {
  const ofCallee = (n: TraceNode) =>
    !!n.inv &&
    isFiniteTrace(n) &&
    n.inv.name === callee.name &&
    sourceFileKey(n.inv.file) === sourceFileKey(callee.file);
  const all = trace.filter(ofCallee);
  const siblingCalls = caller.calls.filter((c) => c.callee === call.callee);
  const callIndex = siblingCalls.findIndex((c) => c.line === call.line && c.column === call.column);
  const distinguished =
    siblingCalls.length > 1 &&
    siblingCalls.every((c) => all.some((n) => n.inv!.callerLine === c.line));
  if (distinguished) return all.filter((n) => n.inv!.callerLine === call.line);
  // Generated stacks often pin every call to one caller line. One call can
  // still take every node; several calls split by invocation serial (source order).
  if (siblingCalls.length <= 1) return all;
  if (callIndex < 0) return [];
  const bySerial = all.filter((n) => (n.inv?.serial ?? 0) === callIndex);
  if (bySerial.length > 0) return bySerial;
  return callIndex === 0 ? all : [];
}

function addNestedLive(
  live: Set<string>,
  trace: readonly TraceNode[],
  fn: MentionFn,
  mentions: readonly MentionFile[],
  seen: Set<string>,
): void {
  const key = `${sourceFileKey(fn.file)}\0${fn.name ?? ""}\0${fn.start}`;
  if (seen.has(key)) return;
  seen.add(key);
  for (const call of fn.calls) {
    const callee = findFn(mentions, { file: fn.file, name: call.callee });
    const found =
      callee ?? mentions.flatMap((m) => m.functions).find((f) => f.name === call.callee);
    if (!found) continue;
    for (const n of childNodes(trace, found, call, fn)) live.add(traceKey(n));
    addNestedLive(live, trace, found, mentions, seen);
  }
}

function exprForCall(
  call: MentionFn["calls"][number],
  callee: MentionFn,
  id: string,
): Expr | undefined {
  if (callee.return.kind === "bag") {
    const field = callee.return.fields.find((f) => f.id === id);
    if (!field) return undefined;
    if (call.binding.kind === "const") return member(call.binding.name, field.field);
    if (call.binding.kind === "destructure") {
      const name = call.binding.map[field.field];
      return name ? { kind: "ref", name } : undefined;
    }
    return undefined;
  }
  if (callee.return.kind === "value" && callee.return.id === id && call.binding.kind === "const") {
    return { kind: "ref", name: call.binding.name };
  }
}

function put(
  n: TraceNode,
  expr: Expr,
  scope: {
    used: string[];
    points: Record<string, Placed>;
    carriers: Record<string, { expr: Expr; geom: LineLike }>;
    circles: Record<string, { expr: Expr; geom: Circle }>;
    profiles: Record<string, { expr: Expr; geom: Profile }>;
    lengths: Record<string, number>;
    byId: Record<string, Expr>;
    prints: Record<string, Expr>;
  },
): void {
  const key = printExpr(expr);
  if (expr.kind === "ref" && !scope.used.includes(expr.name)) scope.used.push(expr.name);
  scope.byId[n.id] = expr;
  if (n.inv) scope.byId[`${n.id}@${n.inv.serial}`] = expr;
  scope.prints[traceKey(n)] = expr;
  if (n.value.kind === "point") {
    scope.points[key] = { expr, at: { x: n.value.x, y: n.value.y } };
  }
  if (isGlider(n.value)) {
    scope.points[key] = { expr, at: gliderAt(n.value) };
  }
  if (n.value.kind === "line" || n.value.kind === "segment" || n.value.kind === "parallelLine") {
    scope.carriers[key] = { expr, geom: n.value as LineLike };
  }
  if (n.value.kind === "circle") {
    scope.circles[key] = { expr, geom: n.value as Circle };
  }
  if (n.value.kind === "profile") {
    scope.profiles[key] = { expr, geom: n.value as Profile };
  }
  if (n.value.kind === "slider") {
    if (expr.kind === "ref") scope.lengths[expr.name] = n.value.n;
  }
}

export function scopeFromTrace(
  trace: readonly TraceNode[],
  opts?: { focus?: ScopeFocus; mentions?: readonly MentionFile[] },
): Scope {
  const used: string[] = [];
  const points: Record<string, Placed> = {};
  const carriers: Record<string, Scope["carriers"][string]> = {};
  const circles: Record<string, { expr: Expr; geom: Circle }> = {};
  const profilesRec: Record<string, { expr: Expr; geom: Profile }> = {};
  const lengths: Record<string, number> = {};
  const byId: Record<string, Expr> = {};
  const prints: Record<string, Expr> = {};
  const live = new Set<string>();
  const scope = { used, points, carriers, circles, profiles: profilesRec, lengths, byId, prints };

  const focus = opts?.focus;
  const mentions = opts?.mentions;
  const fn = focus && mentions ? findFn(mentions, focus) : undefined;

  for (const n of trace) {
    if (!isFiniteTrace(n)) continue;
    if (fn && focus) {
      if (invMatches(n, focus)) {
        live.add(traceKey(n));
        const bind = reverseBind(fn, n.id);
        if (bind) put(n, { kind: "ref", name: bind }, scope);
      }
      continue;
    }
    if (n.occ !== 0 || !n.bind) continue;
    put(n, { kind: "ref", name: n.bind }, scope);
  }
  if (fn && mentions) {
    for (const call of fn.calls) {
      const callee = findFn(mentions, { file: fn.file, name: call.callee });
      const found =
        callee ?? mentions.flatMap((m) => m.functions).find((f) => f.name === call.callee);
      if (!found) continue;
      for (const n of childNodes(trace, found, call, fn)) {
        const expr = exprForCall(call, found, n.id);
        if (expr) put(n, expr, scope);
      }
    }
    addNestedLive(live, trace, fn, mentions, new Set());
  }
  if (fn) {
    for (const name of insertPointNames(fn)) {
      if (!used.includes(name)) used.push(name);
    }
  }
  if (fn && focus) return { ...scope, liveKeys: live };
  return { ...scope, prints: undefined };
}

export function mentionExpr(scope: Scope, n: TraceNode): Expr | undefined {
  return scope.prints?.[traceKey(n)] ?? (n.inv ? scope.byId[`${n.id}@${n.inv.serial}`] : undefined) ?? scope.byId[n.id];
}

export function mentionPrint(scope: Scope, n: TraceNode): string | undefined {
  const expr = mentionExpr(scope, n);
  return expr ? printExpr(expr) : undefined;
}

export function snapFilterOf(scope: Scope): SnapFilter | undefined {
  if (!scope.prints) return undefined;
  return {
    keys: new Set(Object.keys(scope.prints)),
    print: (n) => mentionPrint(scope, n),
  };
}

export function mutedForScope(n: TraceNode, scope: Scope): boolean {
  if (!scope.liveKeys) return false;
  return !scope.liveKeys.has(traceKey(n));
}

/** Pane scope when present; never rebuild an unfocused occ-0 scope for tool hit/hover. */
export function toolScope(ctx: { scope?: Scope; trace: readonly TraceNode[] }): Scope {
  return ctx.scope ?? scopeFromTrace(ctx.trace);
}

type LooseScope = {
  used: readonly string[];
  points?: Record<string, unknown>;
  carriers?: Record<string, unknown>;
  circles?: Record<string, unknown>;
  profiles?: Record<string, unknown>;
  lengths?: Record<string, number>;
  byId?: Record<string, unknown>;
  prints?: Record<string, unknown>;
  liveKeys?: ReadonlySet<string>;
};

export type ScopeInput = Scope | readonly string[] | LooseScope;

export function scopeOf(x?: ScopeInput): Scope {
  if (!x) return EMPTY_SCOPE;
  if (Array.isArray(x)) return { ...EMPTY_SCOPE, used: x };
  return { ...EMPTY_SCOPE, ...(x as Partial<Scope>) };
}

export type { TraceInv };
