let pending: (() => void)[] | undefined;

/**
 * Defer `fn` to the next macrotask, merged with any other HMR updates that
 * arrive before it. Vite runs the per-module accept callbacks in separate
 * tasks (the scene re-execution resolves through a dynamic import), so Solid
 * would flush the world memo once per event; batching here collapses them
 * into a single re-run.
 */
export function batchHmr(fn: () => void): void {
  if (!pending) {
    pending = [];
    setTimeout(() => {
      const fns = pending!;
      pending = undefined;
      for (const f of fns) f();
    }, 0);
  }
  pending.push(fn);
}
