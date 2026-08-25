import type { Expr } from "../../source/expr";
import { hitSlider, sliderNodes } from "../view/sliderHud";
import { round } from "./common";
import { parseNum } from "./draft";
import type { Field, PlaceCtx, PlaceHit, Scope } from "./types";

export type LengthDraft = { typed: string; lengthReuse?: string };

export function resolveLengthRef(raw: string, scope: Scope, reuse?: string): Expr | null {
  if (reuse) return { kind: "ref", name: reuse };
  const t = raw.trim();
  if (t && scope.lengths[t] != null) return { kind: "ref", name: t };
  return null;
}

export function resolveLengthExpr(session: LengthDraft, scope: Scope, opts?: { min?: number }): Expr | null {
  const ref = resolveLengthRef(session.typed, scope, session.lengthReuse);
  if (ref) return ref;
  const n = parseNum(session.typed);
  if (n == null) return null;
  const v = opts?.min != null ? Math.max(opts.min, n) : n;
  return { kind: "num", value: round(v) };
}

export function lengthValue(session: LengthDraft, scope: Scope, fallback: number): number {
  const bind =
    session.lengthReuse ?? (scope.lengths[session.typed.trim()] != null ? session.typed.trim() : undefined);
  if (bind) return scope.lengths[bind] ?? fallback;
  const n = parseNum(session.typed);
  if (n != null) return n;
  return fallback;
}

export function lengthLabel(session: LengthDraft, scope: Scope, fallback: string): string {
  if (session.lengthReuse) return session.lengthReuse;
  const t = session.typed.trim();
  if (t && scope.lengths[t] != null) return t;
  return session.typed.trim() || fallback;
}

export function resolveNumberExpr(raw: string, scope: Scope, fallback?: number): Expr | null {
  const ref = resolveLengthRef(raw, scope);
  if (ref) return ref;
  const n = parseNum(raw);
  if (n != null) return { kind: "num", value: round(n) };
  if (fallback != null) return { kind: "num", value: round(fallback) };
  return null;
}

export function numberValue(raw: string, scope: Scope, fallback: number): number {
  const t = raw.trim();
  if (t && scope.lengths[t] != null) return scope.lengths[t] ?? fallback;
  const n = parseNum(raw);
  if (n != null) return n;
  return fallback;
}

export function hasNumberBinding(raw: string, scope: Scope): boolean {
  return resolveNumberExpr(raw, scope) != null;
}

export function attachLengthHit(hit: PlaceHit, ctx: Pick<PlaceCtx, "trace" | "screen">): PlaceHit {
  if (hit.length) return hit;
  if (!ctx.screen) return hit;
  const slider = hitSlider(ctx.screen, sliderNodes(ctx.trace));
  if (!slider?.bind || slider.value.kind !== "slider") return hit;
  return { ...hit, length: { bind: slider.bind, value: slider.value.n } };
}

export function numberField<S>(
  id: string,
  placeholder: string,
  get: (session: S) => string,
  set: (session: S, raw: string) => S,
): Field<S> {
  return { id, kind: "length", placeholder, open: () => true, get, set };
}
