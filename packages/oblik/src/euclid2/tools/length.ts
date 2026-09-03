import type { TraceNode } from "@/eval/context";
import type { Circle, ParallelLine } from "@/geom";
import { printExpr, member, parsePath, rootRef, type Expr, type ProductField } from "@/source/expr";

import { hitsNear, nodeByPrint, nodeByTraceAttr } from "../pick";
import { isPinnedPoint } from "../place";
import { hitSlider, sliderNodes } from "../view/sliderHud";
import { round } from "./common";
import { parseNum } from "./draft";
import { toolScope } from "./scope";
import type { Field, PlaceCtx, PlaceHit, Scope, ToolSession } from "./types";


const { abs, max } = Math;
export type LengthDraft = { typed: string; lengthPick?: Expr };

export function lengthNegPending(raw: string | undefined): boolean {
  return (raw ?? "").trim() === "-";
}

export function wrapLengthNeg(expr: Expr, pending: boolean): Expr {
  if (!pending || expr.kind === "neg") return expr;
  return { kind: "neg", expr };
}

function withPendingNeg(
  length: NonNullable<PlaceHit["length"]>,
  pending: boolean,
  scope: Scope,
): NonNullable<PlaceHit["length"]> {
  const expr = wrapLengthNeg(length.expr, pending);
  if (expr === length.expr) return length;
  const value = evalLengthExpr(expr, scope) ?? -length.value;
  return { expr, value };
}

export function memberExpr(object: string, field: ProductField): Expr {
  return member(parsePath(object), field);
}

export function lengthRefName(expr: Expr): string | null {
  return expr.kind === "ref" ? expr.name : null;
}

function objectKey(expr: Expr): string | null {
  if (expr.kind === "ref") return expr.name;
  if (expr.kind === "member") return printExpr(expr);
  return null;
}

export function fieldValue(scope: Scope, object: string, field: string): number | null {
  if (field === "radius") {
    const c = scope.circles[object];
    return c ? abs(c.geom.radius) : null;
  }
  const carrier = scope.carriers[object];
  if (field === "distance" && carrier?.geom.kind === "parallelLine") {
    return (carrier.geom as ParallelLine).distance;
  }
  return null;
}

export function evalLengthExpr(expr: Expr, scope: Scope): number | null {
  if (expr.kind === "num") return expr.value;
  if (expr.kind === "ref") return scope.lengths[expr.name] ?? null;
  if (expr.kind === "member") {
    const key = objectKey(expr.object);
    return key ? fieldValue(scope, key, expr.field) : null;
  }
  if (expr.kind === "neg") {
    const v = evalLengthExpr(expr.expr, scope);
    return v == null ? null : -v;
  }
  return null;
}

function parseMember(rest: string, scope: Scope): Expr | null {
  const dot = rest.lastIndexOf(".");
  if (dot <= 0) return null;
  const object = rest.slice(0, dot);
  const field = rest.slice(dot + 1);
  if (field === "radius" && scope.circles[object]) return memberExpr(object, "radius");
  if (field === "distance" && scope.carriers[object]?.geom.kind === "parallelLine") {
    return memberExpr(object, "distance");
  }
  return null;
}

export function parseLengthTyped(raw: string, scope: Scope, opts?: { min?: number }): Expr | null {
  const t = raw.trim();
  if (t === "" || t === "-") return null;
  const n = parseNum(t);
  if (n != null) {
    const v = opts?.min != null ? max(opts.min, n) : n;
    return { kind: "num", value: round(v) };
  }
  let neg = false;
  let rest = t;
  if (rest.startsWith("-")) {
    neg = true;
    rest = rest.slice(1).trim();
    if (rest === "") return null;
  }
  const parsedMember = parseMember(rest, scope);
  if (parsedMember) return wrapLengthNeg(parsedMember, neg);
  if (scope.lengths[rest] != null) {
    return wrapLengthNeg({ kind: "ref", name: rest }, neg);
  }
  return null;
}

export function resolveLengthExpr(
  session: LengthDraft,
  scope: Scope,
  opts?: { min?: number },
): Expr | null {
  if (session.lengthPick) return session.lengthPick;
  return parseLengthTyped(session.typed, scope, opts);
}

export function lengthValue(session: LengthDraft, scope: Scope, fallback: number): number {
  const expr = resolveLengthExpr(session, scope);
  if (expr) {
    const v = evalLengthExpr(expr, scope);
    if (v != null) return v;
  }
  return fallback;
}

export function lengthLabel(session: LengthDraft, scope: Scope, fallback: string): string {
  if (session.lengthPick) return printExpr(session.lengthPick);
  const parsed = parseLengthTyped(session.typed, scope);
  if (parsed) return printExpr(parsed);
  if (lengthNegPending(session.typed)) return "-";
  return session.typed.trim() || fallback;
}

export function resolveNumberExpr(raw: string, scope: Scope, fallback?: number): Expr | null {
  const parsed = parseLengthTyped(raw, scope);
  if (parsed) return parsed;
  if (fallback != null) return { kind: "num", value: round(fallback) };
  return null;
}

export function numberValue(raw: string, scope: Scope, fallback: number): number {
  const parsed = parseLengthTyped(raw, scope);
  if (parsed) {
    const v = evalLengthExpr(parsed, scope);
    if (v != null) return v;
  }
  return fallback;
}

export function hasNumberBinding(raw: string, scope: Scope): boolean {
  return parseLengthTyped(raw, scope) != null;
}

export type LengthPickField = ProductField;

function lengthFromNode(
  node: TraceNode,
  field: LengthPickField,
  print?: string,
): { expr: Expr; value: number } | null {
  const name = print ?? node.bind;
  if (!name) return null;
  if (field === "radius" && node.value.kind === "circle") {
    const c = node.value as Circle;
    return { expr: memberExpr(name, "radius"), value: abs(c.radius) };
  }
  if (field === "distance" && node.value.kind === "parallelLine") {
    const pl = node.value as ParallelLine;
    return { expr: memberExpr(name, "distance"), value: pl.distance };
  }
  return null;
}

function nearestLengthPick(
  trace: readonly TraceNode[],
  world: { x: number; y: number },
  camera: import("../camera").Camera2,
  size: import("../camera").PaneSize,
  accept: readonly LengthPickField[],
  print?: (n: TraceNode) => string | undefined,
  keys?: ReadonlySet<string>,
): { expr: Expr; value: number } | null {
  for (const n of hitsNear(trace, world, camera, size)) {
    if (keys && !keys.has(`${n.id}:${n.occ}`)) continue;
    for (const field of accept) {
      const pick = lengthFromNode(n, field, print?.(n));
      if (pick) return pick;
    }
  }
  return null;
}

function lengthPickFromNode(
  node: TraceNode,
  accept: readonly LengthPickField[],
  pending: boolean,
  scope: Scope,
  print?: string,
): PlaceHit["length"] | null {
  for (const field of accept) {
    const pick = lengthFromNode(node, field, print);
    if (!pick) continue;
    const expr = wrapLengthNeg(pick.expr, pending);
    const value = evalLengthExpr(expr, scope) ?? (pending ? -pick.value : pick.value);
    return { expr, value };
  }
  return null;
}

function isDomElement(t: EventTarget | null | undefined): t is Element {
  return typeof Element !== "undefined" && t instanceof Element;
}

export function attachLengthHit(
  hit: PlaceHit,
  ctx: Pick<
    PlaceCtx,
    "trace" | "camera" | "size" | "screen" | "target" | "keys" | "print" | "scope"
  >,
  draft: LengthDraft,
  accept: readonly LengthPickField[] = [],
): PlaceHit {
  const pending = lengthNegPending(draft.typed ?? "");
  const scope = toolScope(ctx);
  if (hit.length) return { ...hit, length: withPendingNeg(hit.length, pending, scope) };
  if (ctx.screen) {
    const slider = hitSlider(ctx.screen, sliderNodes(ctx.trace));
    if (slider && slider.value.kind === "slider") {
      const name = ctx.print?.(slider) ?? slider.bind;
      if (name && (!ctx.keys || ctx.keys.has(`${slider.id}:${slider.occ}`))) {
        const expr = wrapLengthNeg({ kind: "ref", name }, pending);
        const value = evalLengthExpr(expr, scope) ?? (pending ? -slider.value.n : slider.value.n);
        return { ...hit, length: { expr, value } };
      }
    }
  }
  if (isPinnedPoint(hit.point)) return hit;
  let node: TraceNode | undefined;
  const target = ctx.target;
  if (isDomElement(target)) {
    const inkEl = target.closest("[data-ink]");
    const id = inkEl?.getAttribute("data-ink");
    if (id) node = nodeByTraceAttr(ctx.trace, id);
  }
  if (node && (!ctx.keys || ctx.keys.has(`${node.id}:${node.occ}`))) {
    const picked = lengthPickFromNode(node, accept, pending, scope, ctx.print?.(node));
    if (picked) return { ...hit, length: picked };
  }
  if (accept.length > 0) {
    const picked = nearestLengthPick(
      ctx.trace,
      hit.world,
      ctx.camera,
      ctx.size,
      accept,
      ctx.print,
      ctx.keys,
    );
    if (picked) {
      const expr = wrapLengthNeg(picked.expr, pending);
      const value = evalLengthExpr(expr, scope) ?? (pending ? -picked.value : picked.value);
      return { ...hit, length: { expr, value } };
    }
  }
  return hit;
}

export function lengthHover(hit: PlaceHit, trace: readonly TraceNode[]): string | null {
  if (!hit.length) return null;
  const e = hit.length.expr;
  if (e.kind === "member") {
    const name = rootRef(e);
    return name
      ? (nodeByPrint(trace, printExpr(e))?.id ?? nodeByPrint(trace, name)?.id ?? null)
      : null;
  }
  if (e.kind === "neg" && e.expr.kind === "member") {
    const name = rootRef(e.expr);
    return name
      ? (nodeByPrint(trace, printExpr(e.expr))?.id ?? nodeByPrint(trace, name)?.id ?? null)
      : null;
  }
  if (e.kind === "ref") {
    return nodeByPrint(trace, e.name)?.id ?? null;
  }
  if (e.kind === "neg" && e.expr.kind === "ref") {
    return nodeByPrint(trace, e.expr.name)?.id ?? null;
  }
  return null;
}

export function numberField<S extends ToolSession>(
  id: string,
  placeholder: string,
  get: (session: S) => string,
  set: (session: S, raw: string) => S,
): Field<S> {
  return { id, kind: "length", placeholder, open: () => true, get, set };
}
