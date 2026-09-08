import type { Annotation } from "../source/analyze";
import { currentEval, nodeOf, withEval, type EvalCtx, type TraceNode } from "./context";
import { sweepMemo, type EvalMemo } from "./memo";
import type { Scene } from "./scene";

export type Draft = Map<string, number[]>;

export type EvaluateOpts = {
  draft?: Draft;
  annotations?: Map<string, Annotation> | Record<string, Annotation>;
  module?: string;
  /**
   * Capture constructor stacks. Default true. Live drag preview sets this
   * false; mouse-up re-evaluates with stacks for the sidebar.
   */
  captureStack?: boolean;
  /** Cross-eval constructor memo, owned by the caller and keyed on the scene module. */
  memo?: EvalMemo;
};

export type EvalStats = { built: number; hits: number };

export type EvaluateResult = {
  value: unknown;
  trace: TraceNode[];
  stats: EvalStats;
};

function asMap(a?: EvaluateOpts["annotations"]): Map<string, Annotation> {
  if (!a) return new Map();
  if (a instanceof Map) return a;
  return new Map(Object.entries(a));
}

export function evaluate(mod: Scene, opts: EvaluateOpts = {}): EvaluateResult {
  const ctx: EvalCtx = {
    draft: opts.draft ?? new Map(),
    trace: [],
    annotations: asMap(opts.annotations),
    occ: new Map(),
    module: opts.module,
    captureStack: opts.captureStack !== false,
    memo: opts.memo,
    stats: { built: 0, hits: 0 },
  };
  const value = withEval(ctx, () => mod.build());
  if (ctx.memo) sweepMemo(ctx.memo, ctx.occ);
  return { value, trace: ctx.trace, stats: ctx.stats };
}

/** Same as `evaluate`, but a thrown `build()` becomes an error string instead of a crash. */
export function tryEvaluate(
  mod: Scene,
  opts: EvaluateOpts = {},
): EvaluateResult & { error: string | undefined } {
  try {
    return { ...evaluate(mod, opts), error: undefined };
  } catch (err) {
    return {
      value: undefined,
      trace: [],
      stats: { built: 0, hits: 0 },
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Copy selected traced values onto the current tape (same ids). */
export function emit(values: unknown | unknown[]): void {
  const cur = currentEval();
  if (!cur) return;
  const list = Array.isArray(values) ? values : [values];
  for (const v of list) {
    const n = nodeOf(v);
    if (n) cur.trace.push(n);
  }
}
