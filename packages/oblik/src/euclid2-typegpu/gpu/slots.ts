export type Range = { start: number; count: number };

/**
 * Keyed contiguous slot runs over a fixed capacity. Runs keep their start across
 * ticks while they fit, so a drag rewrites one slot instead of re-uploading the
 * world. Freed ranges are kept sorted and merged for first-fit reuse.
 *
 * The key is the adapter's **node key** (`id:occ`), not the node object: the
 * trace-reuse pass only preserves object identity for nodes whose drawn value is
 * *unchanged*, so a moved node arrives as a fresh object every tick and an
 * identity-keyed pool would treat it as a new node — re-uploading everything it
 * owns. The key is what the reuse pass itself matches on (`reuse-trace.ts`), so
 * it is stable exactly when the node is.
 */
export type SlotPool = {
  /** Current or fresh run start for `key`; undefined when capacity runs out. */
  alloc(key: string, count: number): number | undefined;
  release(key: string): void;
  /** Release every run whose key is not in `keys` (called once per tick). */
  sync(keys: ReadonlySet<string>): void;
  runOf(key: string): Range | undefined;
  /** Live slots (released keys freed; zero-count runs are not stored). */
  readonly used: number;
  readonly capacity: number;
  reset(): void;
};

export function createSlotPool(capacity: number): SlotPool {
  const runs = new Map<string, Range>();
  /** Sorted by start, non-overlapping, never adjacent; starts as one full run. */
  const free: Range[] = [{ start: 0, count: capacity }];
  let freeSlots = capacity;

  function addFree(range: Range) {
    if (range.count <= 0) return;
    let i = 0;
    while (i < free.length && free[i]!.start < range.start) i++;
    const prev = free[i - 1];
    const next = free[i];
    if (prev && prev.start + prev.count === range.start) {
      prev.count += range.count;
      if (next && prev.start + prev.count === next.start) {
        prev.count += next.count;
        free.splice(i, 1);
      }
      return;
    }
    if (next && range.start + range.count === next.start) {
      next.start = range.start;
      next.count += range.count;
      return;
    }
    free.splice(i, 0, range);
  }

  function release(key: string) {
    const run = runs.get(key);
    if (!run) return;
    runs.delete(key);
    addFree(run);
    freeSlots += run.count;
  }

  function findRun(count: number): number | undefined {
    for (let i = 0; i < free.length; i++) {
      const r = free[i]!;
      if (r.count >= count) {
        const start = r.start;
        if (r.count === count) {
          free.splice(i, 1);
        } else {
          r.start += count;
          r.count -= count;
        }
        freeSlots -= count;
        return start;
      }
    }
    return undefined;
  }

  return {
    alloc(key, count) {
      if (count <= 0) return runs.get(key)?.start ?? 0;
      const existing = runs.get(key);
      if (existing && existing.count >= count) return existing.start;
      if (existing) {
        release(key);
        if (count > capacity) return undefined;
      }
      const start = findRun(count);
      if (start === undefined) {
        // The released run may not have re-fit; capacity is exhausted either way.
        return undefined;
      }
      runs.set(key, { start, count });
      return start;
    },
    release,
    sync(keys) {
      // Map iteration tolerates deletion mid-loop; release only touches `runs`.
      for (const key of runs.keys()) {
        if (!keys.has(key)) release(key);
      }
    },
    runOf(key) {
      return runs.get(key);
    },
    get used() {
      return capacity - freeSlots;
    },
    capacity,
    reset() {
      runs.clear();
      // Back to the documented initial state: one run covering the capacity.
      // (Emptying `free` instead left `findRun` with nothing to hand out, so
      // every `alloc` after a reset returned undefined.)
      free.length = 0;
      free.push({ start: 0, count: capacity });
      freeSlots = capacity;
    },
  };
}
