import { writeToArrayBuffer } from "typegpu";
import type { TgpuBuffer } from "typegpu";
import { arrayOf, sizeOf } from "typegpu/data";
import type { AnyWgslData, Infer } from "typegpu/data";

/**
 * A CPU mirror of one record buffer, written in fixed-size chunks.
 *
 * A record is built once per slot and mutated in place afterwards, and a slot is
 * only serialized when its inputs actually moved: `touch` compares a signature of
 * a handful of numbers *before* anything is built, so an unchanged node costs N
 * comparisons and allocates nothing. Serializing and marking dirty happen inside
 * that same call, which is why the pooled record and the staged bytes cannot
 * drift apart — a record is never mutated without also being staged.
 *
 * What changed is tracked per *chunk*, not per record, and `flush` writes each
 * run of adjacent dirty chunks as one raw byte copy. That is the only write shape
 * WebGPU makes cheap: one write per record measured ~4.7 ms for a scene, one
 * contiguous write ~6 µs. The granularity it costs is bounded and small — a
 * changed record drags up to CHUNK-1 unchanged neighbours along with it (< 1 KiB
 * for the records here) — and in exchange the flush is a scan over nChunks flags
 * with no sorting, no per-frame bookkeeping arrays and no per-record calls. A
 * whole-scene drag is one run; a hover is one chunk.
 *
 * Everything here is schema-derived. The two byte numbers are the size of one
 * record and of one chunk *of the very array the buffer was laid out with*, which
 * is the only thing `writeToArrayBuffer` will accept; nothing computes a field
 * offset. Note the shape it must be called with: the element schema form
 * (`writeToArrayBuffer(staging, StrokeDraw, record, { startOffset })`) silently
 * writes *nothing* at a non-zero offset, because `calculateOffsets` clamps
 * `endOffset` to one element — so a record is always carried in a one-element
 * array of the array schema, which round-trips exactly (`recordPool.test.ts`).
 */

/** Records per chunk. Small enough that a lone change wastes little, big enough
 * that a scene is a handful of runs. */
export const CHUNK = 16;

/** One run of adjacent dirty chunks: the bytes to upload, and where they go. */
export type ChunkRun = {
  /** The staged bytes, in slot order — a view of the pool's mirror. */
  bytes: Uint8Array;
  /** **Byte** offset into the record buffer (`chunk * bytesPerChunk`). */
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
  /** Hand every run of dirty chunks to `write`, clear the flags, and report how
   * many records were staged since the last flush. */
  flush(write: (run: ChunkRun) => void): number;
  reset(): void;
};

export function createRecordPool<TData extends AnyWgslData>(opts: {
  element: TData;
  count: number;
  make: () => Infer<TData>;
}): RecordPool<Infer<TData>> {
  const { element, count, make } = opts;
  if (count % CHUNK !== 0) {
    throw new Error(`record capacity ${count} is not a whole number of ${CHUNK}-record chunks`);
  }
  const schema = arrayOf(element, count);
  /** One record, and one chunk, of the array the buffer is laid out as. Both are
   * `sizeOf` of that array's own shapes rather than lengths times a literal. */
  const bytesPerRecord = sizeOf(arrayOf(element, 1));
  const bytesPerChunk = sizeOf(arrayOf(element, CHUNK));
  const nChunks = count / CHUNK;

  const records: (Infer<TData> | undefined)[] = Array.from({ length: count });
  /** The inputs of whatever last got staged at this slot, or undefined. */
  const signatures: (Float64Array | undefined)[] = Array.from({ length: count });
  const dirty = new Uint8Array(nChunks);
  const staging = new ArrayBuffer(bytesPerChunk * nChunks);
  const stagingView = new Uint8Array(staging);
  /** A one-element carrier, reused: serializing a record allocates nothing. */
  const single: Infer<TData>[] = [];
  let staged = 0;

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
      dirty[Math.floor(slot / CHUNK)] = 1;
      staged++;
    },
    recordAt(slot) {
      return records[slot];
    },
    retire(slot) {
      signatures[slot] = undefined;
    },
    flush(write) {
      for (let chunk = 0; chunk < nChunks;) {
        if (dirty[chunk] === 0) {
          chunk++;
          continue;
        }
        let end = chunk + 1;
        while (end < nChunks && dirty[end] === 1) end++;
        const startOffset = chunk * bytesPerChunk;
        write({ bytes: stagingView.subarray(startOffset, end * bytesPerChunk), startOffset });
        dirty.fill(0, chunk, end);
        chunk = end;
      }
      const written = staged;
      staged = 0;
      return written;
    },
    reset() {
      signatures.fill(undefined);
      dirty.fill(0);
      staged = 0;
    },
  };
}

/**
 * Hand a patch's staged runs to their buffer.
 *
 * The cast is a typings gap, not a shortcut: `TgpuBuffer.write` declares an
 * `ArrayBuffer` overload and a record-array overload, while `writeToArrayBuffer`
 * routes any `ArrayBufferView` through the same raw byte copy — the fastest path
 * there is, and the one a run of staged records wants. Passing the run's view
 * keeps its own byte offset and length; passing its `.buffer` would upload the
 * whole mirror from the wrong place.
 */
export function writeChunkRuns<TData extends AnyWgslData>(
  buffer: TgpuBuffer<TData>,
  runs: readonly ChunkRun[],
): void {
  const write = buffer.write.bind(buffer) as unknown as (
    data: Uint8Array,
    options: { startOffset: number },
  ) => void;
  for (const run of runs) write(run.bytes, { startOffset: run.startOffset });
}
