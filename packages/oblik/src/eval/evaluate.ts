import type { Annotation } from "../source/analyze";
import type { Scene } from "./scene";
import { currentEval, nodeOf, withEval, type EvalCtx, type TraceNode } from "./context";

export type Draft = Map<string, number[]>;

export type EvaluateOpts = {
  draft?: Draft;
  annotations?: Map<string, Annotation> | Record<string, Annotation>;
  module?: string;
};

export type EvaluateResult = {
  value: unknown;
  trace: TraceNode[];
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
  };
  const value = withEval(ctx, () => mod.build());
  return { value, trace: ctx.trace };
}

/** Same as `evaluate`, but a thrown `build()` becomes an error string instead of a crash. */
export function tryEvaluate(
  mod: Scene,
  opts: EvaluateOpts = {},
): EvaluateResult & { error: string | null } {
  try {
    return { ...evaluate(mod, opts), error: null };
  } catch (err) {
    return { value: null, trace: [], error: err instanceof Error ? err.message : String(err) };
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
