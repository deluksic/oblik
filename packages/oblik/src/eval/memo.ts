import {
  currentEval,
  isSceneBag,
  nodeOf,
  type EvalCtx,
  type SceneBag,
  type SceneValue,
  type TraceNode,
} from "#eval/context";

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
  fingerprint: SceneValue[];
  value: SceneValue;
  node: TraceNode;
};

const MAX_FINGERPRINT_DEPTH = 4;

/**
 * Raw constructor args (minus the trailing site id) plus the site's own draft
 * row — the only inputs `draftAt` can fold into the constructed value.
 */
function fingerprintOf(
  args: readonly SceneValue[],
  draft: readonly number[] | undefined,
): SceneValue[] {
  return draft === undefined ? [...args] : [...args, draft];
}

export function sameFingerprint(a: readonly SceneValue[], b: readonly SceneValue[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!fpEq(a[i], b[i], 0)) return false;
  }
  return true;
}

function fpEq(a: SceneValue, b: SceneValue, depth: number): boolean {
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
  if (!isSceneBag(a) || !isSceneBag(b)) return false;
  const ra: SceneBag = a;
  const rb: SceneBag = b;
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
export function memoized<A extends SceneValue[], R extends SceneValue>(
  fn: (...args: A) => R,
): (...args: A) => R {
  const wrapped = (...args: A): R => {
    const ctx = currentEval();
    if (!ctx || !ctx.memo || args.length === 0) return fn(...args);
    const last = args[args.length - 1];
    if (typeof last !== "string") return fn(...args);
    const id = last;
    const occ = ctx.occ.get(id) ?? 0;
    const fingerprint = fingerprintOf(args.slice(0, -1), ctx.draft.get(id));
    const key = `${id}:${occ}`;
    const entry = ctx.memo.entries.get(key);
    if (entry && sameFingerprint(entry.fingerprint, fingerprint)) {
      ctx.occ.set(id, occ + 1);
      ctx.trace.push(entry.node);
      ctx.stats.hits++;
      return entry.value as R;
    }
    const value = fn(...args);
    const node = nodeOf(value);
    if (node) {
      ctx.memo.entries.set(key, { fingerprint, value, node });
      ctx.stats.built++;
    }
    return value;
  };
  return wrapped;
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

/**
 * Stale entries are never wrong — a hit still requires a fresh fingerprint
 * compare at the same key — so the sweep only reclaims memory and can wait
 * for idle time. Pending sweeps coalesce: consecutive evals merge their occ
 * tallies (max per id) and one idle pass prunes against the union.
 */
const pendingSweeps = new WeakMap<EvalMemo, { counts: Map<string, number> }>();

export function scheduleSweep(m: EvalMemo, counts: Map<string, number>): void {
  const pending = pendingSweeps.get(m);
  if (pending) {
    for (const [id, n] of counts) {
      const prev = pending.counts.get(id);
      if (prev === undefined || n > prev) pending.counts.set(id, n);
    }
    return;
  }
  const next = { counts: new Map(counts) };
  pendingSweeps.set(m, next);
  const run = () => {
    pendingSweeps.delete(m);
    sweepMemo(m, next.counts);
  };
  // Browser: defer to idle. Node/tests: sweep inline so results are synchronous.
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(() => run(), { timeout: 1000 });
  } else {
    run();
  }
}

// ---- user memo(fn) -----------------------------------------------------------

type UserMemoEntry = { args: SceneValue[]; result: SceneValue };

const userMemos = new WeakMap<object, Map<number, UserMemoEntry>>();

/**
 * Cache a user computation inside scene evaluation, keyed by call occurrence.
 * Deterministic call order is required (same limitation as constructor ids in
 * loops). On a hit the previous result object is returned so identity
 * propagates into downstream constructors. The store is keyed on the function
 * object, so an HMR re-import of the defining module invalidates for free.
 */
export function memo<A extends SceneValue[], R extends SceneValue>(
  fn: (...args: A) => R,
): (...args: A) => R {
  const wrapped = (...args: A): R => {
    const ctx: EvalCtx | undefined = currentEval();
    if (!ctx) return fn(...args);
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
      return entry.result as R;
    }
    const result = fn(...args);
    entries.set(occ, { args, result });
    ctx.stats.built++;
    return result;
  };
  return wrapped;
}
