import type { TraceNode } from "../../eval/context";
import type { Circle, ParallelLine } from "../../geom";
import { printExpr, type Expr, type ProductField } from "../../source/expr";
import { hitsNear } from "../pick";
import { hitSlider, sliderNodes } from "../view/sliderHud";
import { round } from "./common";
import { parseNum } from "./draft";
import { scopeFromTrace } from "./scope";
import type { Field, PlaceCtx, PlaceHit, Scope } from "./types";

export type LengthDraft = { typed: string; lengthPick?: Expr };

export function lengthNegPending(raw: string): boolean {
  return raw.trim() === "-";
}

export function wrapLengthNeg(expr: Expr, pending: boolean): Expr {
  return pending ? { kind: "neg", expr } : expr;
}

export function memberExpr(object: string, field: ProductField): Expr {
  return { kind: "member", object, field };
}

export function lengthRefName(expr: Expr): string | null {
  return expr.kind === "ref" ? expr.name : null;
}

export function fieldValue(scope: Scope, object: string, field: ProductField): number | null {
  if (field === "radius") {
    const c = scope.circles[object];
    return c ? Math.abs(c.geom.radius) : null;
  }
  const carrier = scope.carriers[object];
  if (carrier?.geom.kind === "parallelLine") return (carrier.geom as ParallelLine).distance;
  return null;
}

export function evalLengthExpr(expr: Expr, scope: Scope): number | null {
  if (expr.kind === "num") return expr.value;
  if (expr.kind === "ref") return scope.lengths[expr.name] ?? null;
  if (expr.kind === "member") return fieldValue(scope, expr.object, expr.field);
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
    const v = opts?.min != null ? Math.max(opts.min, n) : n;
    return { kind: "num", value: round(v) };
  }
  let neg = false;
  let rest = t;
  if (rest.startsWith("-")) {
    neg = true;
    rest = rest.slice(1).trim();
    if (rest === "") return null;
  }
  const member = parseMember(rest, scope);
  if (member) return wrapLengthNeg(member, neg);
  if (scope.lengths[rest] != null) {
    return wrapLengthNeg({ kind: "ref", name: rest }, neg);
  }
  return null;
}

export function resolveLengthExpr(session: LengthDraft, scope: Scope, opts?: { min?: number }): Expr | null {
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

function lengthFromNode(node: TraceNode, field: LengthPickField): { expr: Expr; value: number } | null {
  if (!node.bind) return null;
  if (field === "radius" && node.value.kind === "circle") {
    const c = node.value as Circle;
    return { expr: memberExpr(node.bind, "radius"), value: Math.abs(c.radius) };
  }
  if (field === "distance" && node.value.kind === "parallelLine") {
    const pl = node.value as ParallelLine;
    return { expr: memberExpr(node.bind, "distance"), value: pl.distance };
  }
  return null;
}

function nearestLengthPick(
  trace: readonly TraceNode[],
  world: { x: number; y: number },
  camera: import("../camera").Camera2,
  size: import("../camera").PaneSize,
  accept: readonly LengthPickField[],
): { expr: Expr; value: number } | null {
  for (const n of hitsNear(trace, world, camera, size)) {
    for (const field of accept) {
      const pick = lengthFromNode(n, field);
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
): PlaceHit["length"] | null {
  for (const field of accept) {
    const pick = lengthFromNode(node, field);
    if (!pick) continue;
    const expr = wrapLengthNeg(pick.expr, pending);
    const value = evalLengthExpr(expr, scope) ?? (pending ? -pick.value : pick.value);
    return { expr, value };
  }
  return null;
}

export function attachLengthHit(
  hit: PlaceHit,
  ctx: Pick<PlaceCtx, "trace" | "camera" | "size" | "screen" | "target">,
  draft: LengthDraft,
  accept: readonly LengthPickField[] = [],
): PlaceHit {
  if (hit.length) return hit;
  const pending = lengthNegPending(draft.typed);
  const scope = scopeFromTrace(ctx.trace);
  if (ctx.screen) {
    const slider = hitSlider(ctx.screen, sliderNodes(ctx.trace));
    if (slider?.bind && slider.value.kind === "slider") {
      const expr = wrapLengthNeg({ kind: "ref", name: slider.bind }, pending);
      const value = evalLengthExpr(expr, scope) ?? (pending ? -slider.value.n : slider.value.n);
      return { ...hit, length: { expr, value } };
    }
  }
  let node: TraceNode | undefined;
  const target = ctx.target;
  if (target instanceof Element) {
    const inkEl = target.closest("[data-ink]");
    const id = inkEl?.getAttribute("data-ink");
    if (id) node = ctx.trace.find((n) => n.id === id && n.occ === 0) ?? ctx.trace.find((n) => n.id === id);
  }
  if (node) {
    const picked = lengthPickFromNode(node, accept, pending, scope);
    if (picked) return { ...hit, length: picked };
  }
  if (accept.length > 0) {
    const picked = nearestLengthPick(ctx.trace, hit.world, ctx.camera, ctx.size, accept);
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
    return trace.find((n) => n.bind === e.object && n.occ === 0)?.id ?? null;
  }
  if (e.kind === "neg" && e.expr.kind === "member") {
    return trace.find((n) => n.bind === e.expr.object && n.occ === 0)?.id ?? null;
  }
  if (e.kind === "ref") {
    return trace.find((n) => n.bind === e.name && n.occ === 0)?.id ?? null;
  }
  return null;
}

export function numberField<S>(
  id: string,
  placeholder: string,
  get: (session: S) => string,
  set: (session: S, raw: string) => S,
): Field<S> {
  return { id, kind: "length", placeholder, open: () => true, get, set };
}
