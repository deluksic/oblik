import { currentEval, nodeOf, type EvalCtx, type TraceNode } from "#eval/context";

/**
 * Per-scene-module memo of constructor results, keyed `${id}:${occ}`.
 * A hit returns the previous eval's value object, so identity propagates
 * downstream by argument references — the dependency frontier needs no graph.
 */
export type EvalMemo = {
  entries: Map<string, MemoEntry>;
};

export function newEvalMemo(): EvalMemo {
  return { entries: new Map() };
}

export type MemoEntry = {
  fingerprint: unknown[];
  value: object;
  node: TraceNode;
};

const MAX_FINGERPRINT_DEPTH = 4;

/**
 * Raw constructor args (minus the trailing site id) plus the site's own draft
 * row — the only inputs `draftAt` can fold into the constructed value.
 */
function fingerprintOf(args: readonly unknown[], draft: readonly number[] | undefined): unknown[] {
  return draft === undefined ? [...args] : [...args, draft];
}

export function sameFingerprint(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!fpEq(a[i], b[i], 0)) return false;
  }
  return true;
}

function fpEq(a: unknown, b: unknown, depth: number): boolean {
  if (Object.is(a, b)) return true;
  if (depth >= MAX_FINGERPRINT_DEPTH) return false;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  // Traced geom compares by identity only: a fresh object means an upstream
  // rebuild, and walking its payload would be O(geometry) — exactly the work
  // this cache exists to skip. A miss is never wrong, just uncached.
  if (nodeOf(a) !== undefined || nodeOf(b) !== undefined) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!fpEq(a[i], b[i], depth + 1)) return false;
    }
    return true;
  }
  if (Array.isArray(b)) return false;
  const proto = Object.getPrototypeOf(a);
  if (proto !== Object.getPrototypeOf(b) || proto !== Object.prototype) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  for (const k of ka) {
    if (!Object.hasOwn(rb, k)) return false;
    if (!fpEq(ra[k], rb[k], depth + 1)) return false;
  }
  return true;
}

/**
 * Memoize a stamped constructor call: on a fingerprint hit, replay the cached
 * tape node (same occ bookkeeping as `traced`) and return the previous value
 * object. Unstamped calls, ghost evals, and unrecordable results (NaN) fall
 * through to the plain constructor.
 */
export function memoized<F extends (...args: never[]) => unknown>(fn: F): F {
  const call = fn as unknown as (...a: unknown[]) => unknown;
  const wrapped = (...args: unknown[]): unknown => {
    const ctx = currentEval();
    if (!ctx || !ctx.memo || args.length === 0) return call(...args);
    const last = args[args.length - 1];
    if (typeof last !== "string") return call(...args);
    const id = last;
    const occ = ctx.occ.get(id) ?? 0;
    const fingerprint = fingerprintOf(args.slice(0, -1), ctx.draft.get(id));
    const key = `${id}:${occ}`;
    const entry = ctx.memo.entries.get(key);
    if (entry && sameFingerprint(entry.fingerprint, fingerprint)) {
      ctx.occ.set(id, occ + 1);
      ctx.trace.push(entry.node);
      ctx.stats.hits++;
      return entry.value;
    }
    const value = call(...args);
    const node = nodeOf(value);
    if (node) {
      ctx.memo.entries.set(key, { fingerprint, value: value as object, node });
      ctx.stats.built++;
    }
    return value;
  };
  return wrapped as unknown as F;
}

/**
 * Drop entries for occurrences that no longer exist (loop shrank, site
 * deleted). Called after a successful eval only — a thrown build leaves the
 * cache untouched. Counts come from the eval's final occ tallies.
 */
export function sweepMemo(m: EvalMemo, counts: Map<string, number>): void {
  for (const key of m.entries.keys()) {
    const cut = key.lastIndexOf(":");
    const id = key.slice(0, cut);
    const occ = Number(key.slice(cut + 1));
    if (occ >= (counts.get(id) ?? 0)) m.entries.delete(key);
  }
}

// ---- user memo(fn) -----------------------------------------------------------

type UserMemoEntry = { args: unknown[]; result: unknown };

const userMemos = new WeakMap<object, Map<number, UserMemoEntry>>();

/**
 * Cache a user computation inside scene evaluation, keyed by call occurrence.
 * Deterministic call order is required (same limitation as constructor ids in
 * loops). On a hit the previous result object is returned so identity
 * propagates into downstream constructors. The store is keyed on the function
 * object, so an HMR re-import of the defining module invalidates for free.
 */
export function memo<F extends (...args: never[]) => unknown>(fn: F): F {
  const call = fn as unknown as (...a: unknown[]) => unknown;
  const wrapped = (...args: unknown[]): unknown => {
    const ctx: EvalCtx | undefined = currentEval();
    if (!ctx) return call(...args);
    const occMap = ctx.userMemoOcc ?? new Map<object, number>();
    ctx.userMemoOcc = occMap;
    const occ = occMap.get(fn) ?? 0;
    occMap.set(fn, occ + 1);
    let entries = userMemos.get(fn);
    if (!entries) {
      entries = new Map();
      userMemos.set(fn, entries);
    }
    const entry = entries.get(occ);
    if (entry && sameFingerprint(entry.args, args)) {
      ctx.stats.hits++;
      return entry.result;
    }
    const result = call(...args);
    entries.set(occ, { args, result });
    ctx.stats.built++;
    return result;
  };
  return wrapped as unknown as F;
}
