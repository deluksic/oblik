import type { Annotation } from "../source/analyze";
import type { Scene } from "./scene";
import { currentEval, nodeOf, withEval, type EvalCtx, type TraceNode } from "./context";

export type Draft = Map<string, number[]>;

export type EvaluateOpts = {
  draft?: Draft;
  annotations?: Map<string, Annotation> | Record<string, Annotation>;
  module?: string;
};

function asMap(a?: EvaluateOpts["annotations"]): Map<string, Annotation> {
  if (!a) return new Map();
  if (a instanceof Map) return a;
  return new Map(Object.entries(a));
}

export function evaluate(mod: Scene, opts: EvaluateOpts = {}): { value: unknown; trace: TraceNode[] } {
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
