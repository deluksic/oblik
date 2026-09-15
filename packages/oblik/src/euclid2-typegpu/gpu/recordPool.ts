import { writeToArrayBuffer } from "typegpu";
import type { TgpuBuffer } from "typegpu";
import { arrayOf, sizeOf } from "typegpu/data";
import type { AnyWgslData, Infer } from "typegpu/data";

/**
 * A CPU mirror of one record buffer, uploading only the spans that changed.
 *
 * A record is built once per slot and mutated in place afterwards, and a slot is
 * only serialized when its inputs actually moved: `touch` compares a signature of
 * a handful of numbers *before* anything is built, so an unchanged node costs N
 * comparisons and allocates nothing. Serializing and recording the change happen
 * inside that same call, which is why the pooled record and the staged bytes
 * cannot drift apart — a record is never mutated without also being staged.
 *
 * The changed *spans* are carried as edits arrive, ascending and disjoint, and
 * `flush` walks the work rather than the capacity: one raw byte copy per span and
 * nothing else, whatever the pool's size. There is no flag array to sweep and
 * nothing to sort — an edit either extends the span it lands in, joins two spans,
 * or is inserted into the list, and a span's place in the list is its place in
 * the buffer. The list is bounded by `count / (GAP_RECORDS + 1)`: bridging edits
 * is what keeps it short, and `GAP_RECORDS` is where it stops paying.
 *
 * Everything here is schema-derived. The byte numbers are `sizeOf` of the very
 * array the buffer was laid out with, and of one record of it; nothing computes a
 * field offset. Note the shape the writer must be called with: the *element*
 * schema form (`writeToArrayBuffer(staging, StrokeDraw, record, { startOffset })`)
 * silently writes **nothing** at a non-zero offset, because `calculateOffsets`
 * clamps `endOffset` to one element — so a record is always carried in a
 * one-element array of the array schema, which round-trips exactly
 * (`recordPool.test.ts`).
 */

/**
 * How many records of clean gap a span absorbs before opening a second one.
 *
 * Measured on this device: a `writeBuffer` call costs ~1.2 µs and a 48-byte
 * record ~10 ns of that, so absorbing is cheaper while a gap is worth fewer than
 * ~120 records of copy. The rule is self-limiting — at the threshold the extra
 * bytes and the saved call cancel — so this sits just above the break-even.
 */
export const GAP_RECORDS = 128;

/** One changed span of the buffer: the bytes to upload, and where they go. */
export type RecordRun = {
  /** The staged bytes, in slot order — a view of the pool's mirror. */
  bytes: Uint8Array;
  /** **Byte** offset into the record buffer (`firstSlot * bytesPerRecord`). */
  startOffset: number;
};

export type RecordPool<T> = {
  /**
   * Stage a slot whose inputs moved; do nothing at all otherwise. `fill` is
   * called with the reusable `args` the caller owns, and only then. Both are
   * passed rather than closed over on purpose: a closure per layer per node per
   * frame is exactly the per-frame garbage this pool exists to remove.
   */
  touch<A>(
    slot: number,
    signature: ArrayLike<number>,
    fill: (record: T, args: A) => void,
    args: A,
  ): void;
  /** The pooled record at a slot, or undefined while nothing has staged there. */
  recordAt(slot: number): T | undefined;
  /** Forget a slot: whatever was staged there was another key's, so the next
   * `touch` stages again whatever its inputs are. */
  retire(slot: number): void;
  /** Hand every changed span to `write` in buffer order, and report how many
   * records were staged since the last flush. */
  flush(write: (run: RecordRun) => void): number;
  reset(): void;
};

export function createRecordPool<TData extends AnyWgslData>(opts: {
  element: TData;
  count: number;
  make: () => Infer<TData>;
}): RecordPool<Infer<TData>> {
  const { element, count, make } = opts;
  const schema = arrayOf(element, count);
  /** One record of the array the buffer is laid out as — the stride every byte
   * offset here is a multiple of. */
  const bytesPerRecord = sizeOf(arrayOf(element, 1));

  const records: (Infer<TData> | undefined)[] = Array.from({ length: count });
  /** The inputs of whatever last got staged at this slot, or undefined. */
  const signatures: (Float64Array | undefined)[] = Array.from({ length: count });
  const staging = new ArrayBuffer(bytesPerRecord * count);
  const stagingView = new Uint8Array(staging);
  /** A one-element carrier, reused: serializing a record allocates nothing. */
  const single: Infer<TData>[] = [];
  /** The changed spans, `[start, end)` in records: ascending, disjoint, and
   * never closer together than `GAP_RECORDS`. Reused across flushes, so a steady
   * frame allocates nothing here either. */
  const runs: { start: number; end: number }[] = [];
  let runCount = 0;
  let staged = 0;

  /** Put `[start, end)` at `index`, reusing the object that was beyond the end
   * of the list when the list last had this many spans. */
  function insertRun(index: number, start: number, end: number): void {
    const spare = runs[runCount];
    const run = spare ?? { start: 0, end: 0 };
    runs[runCount] = run;
    for (let i = runCount; i > index; i--) runs[i] = runs[i - 1]!;
    run.start = start;
    run.end = end;
    runs[index] = run;
    runCount++;
  }

  /**
   * Record `slot` as changed.
   *
   * The fast path is the common one: nodes are visited in the order their slots
   * were handed out, so an edit usually lands at or after the last span, where
   * recording it is a comparison and a store. Everything else — a node that came
   * back to an earlier slot, a hover that moved — searches for the span it
   * belongs in, joining its neighbours when the gaps allow and bridging them when
   * it lands between two.
   */
  function markChanged(slot: number): void {
    const end = slot + 1;
    const last = runCount > 0 ? runs[runCount - 1]! : undefined;
    if (last !== undefined && slot >= last.start && slot - last.end <= GAP_RECORDS) {
      if (end > last.end) last.end = end;
      return;
    }
    // The first span that does not end before this slot.
    let lo = 0;
    let hi = runCount;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (runs[mid]!.end < slot) lo = mid + 1;
      else hi = mid;
    }
    const next = lo < runCount ? runs[lo]! : undefined;
    if (next !== undefined && slot >= next.start) return; // already covered
    const prev = lo > 0 ? runs[lo - 1]! : undefined;
    const joinsPrev = prev !== undefined && slot - prev.end <= GAP_RECORDS;
    const joinsNext = next !== undefined && next.start - end <= GAP_RECORDS;
    if (joinsPrev && joinsNext) {
      // Between two spans, close enough to both: one span now.
      prev!.end = next!.end;
      for (let i = lo; i < runCount - 1; i++) runs[i] = runs[i + 1]!;
      runCount--;
      return;
    }
    if (joinsPrev) {
      if (end > prev!.end) prev!.end = end;
      return;
    }
    if (joinsNext) {
      next!.start = slot;
      return;
    }
    insertRun(lo, slot, end);
  }

  function changed(slot: number, signature: ArrayLike<number>): boolean {
    const prev = signatures[slot];
    if (prev === undefined || prev.length !== signature.length) return true;
    for (let i = 0; i < signature.length; i++) {
      if (prev[i] !== signature[i]) return true;
    }
    return false;
  }

  return {
    touch(slot, signature, fill, args) {
      // A slot past the end would be ignored by the typed arrays below — an
      // upload that never happens, drawn from whatever the buffer already held.
      // The two pools' capacities have to agree, and this is where that is said.
      if (slot >= count || slot < 0) {
        throw new Error(`record slot ${slot} is outside this pool's ${count} records`);
      }
      if (!changed(slot, signature)) return;
      const prev = signatures[slot];
      if (prev !== undefined && prev.length === signature.length) {
        for (let i = 0; i < signature.length; i++) prev[i] = signature[i]!;
      } else {
        const next = new Float64Array(signature.length);
        for (let i = 0; i < signature.length; i++) next[i] = signature[i]!;
        signatures[slot] = next;
      }
      let record = records[slot];
      if (record === undefined) {
        record = make();
        records[slot] = record;
      }
      fill(record, args);
      single.length = 0;
      single.push(record);
      writeToArrayBuffer(staging, schema, single, { startOffset: slot * bytesPerRecord });
      markChanged(slot);
      staged++;
    },
    recordAt(slot) {
      return records[slot];
    },
    retire(slot) {
      signatures[slot] = undefined;
    },
    flush(write) {
      for (let i = 0; i < runCount; i++) {
        const run = runs[i]!;
        const startOffset = run.start * bytesPerRecord;
        write({ bytes: stagingView.subarray(startOffset, run.end * bytesPerRecord), startOffset });
      }
      runCount = 0;
      const written = staged;
      staged = 0;
      return written;
    },
    reset() {
      signatures.fill(undefined);
      runCount = 0;
      staged = 0;
    },
  };
}

/**
 * Hand a patch's staged spans to their buffer.
 *
 * The cast is a typings gap, not a shortcut: `TgpuBuffer.write` declares an
 * `ArrayBuffer` overload and a record-array overload, while `writeToArrayBuffer`
 * routes any `ArrayBufferView` through the same raw byte copy — the fastest path
 * there is, and the one a staged span wants. Passing the span's view keeps its
 * own byte offset and length; passing its `.buffer` would upload the whole mirror
 * from the wrong place.
 */
export function writeRuns<TData extends AnyWgslData>(
  buffer: TgpuBuffer<TData>,
  runs: readonly RecordRun[],
): void {
  const write = buffer.write.bind(buffer) as unknown as (
    data: Uint8Array,
    options: { startOffset: number },
  ) => void;
  for (const run of runs) write(run.bytes, { startOffset: run.startOffset });
}
