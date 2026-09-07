const pending: (() => void)[] = [];
let scheduled = false;

/**
 * Defer `fn` to the next macrotask, merged with any other HMR updates that
 * arrive before it. Vite runs the per-module accept callbacks in separate
 * tasks (the scene re-execution resolves through a dynamic import), so Solid
 * would flush the world memo once per event; batching here collapses them
 * into a single re-run.
 */
export function batchHmr(fn: () => void): void {
  pending.push(fn);
  if (scheduled) return;
  scheduled = true;
  setTimeout(() => {
    scheduled = false;
    for (const f of pending.splice(0)) f();
  }, 0);
}
