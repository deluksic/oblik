import { readFromArrayBuffer, writeToArrayBuffer } from "typegpu";
import { arrayOf, f32, sizeOf, struct } from "typegpu/data";
import { describe, expect, test } from "vitest";

import { CHUNK, createRecordPool, type ChunkRun } from "./recordPool";
import { StrokeDraw } from "./schemas";

/**
 * The batch contract, which a GPU error once enforced the hard way: the offset
 * a staged run is written at is a **byte** offset into the record buffer, not a
 * slot index. A wrong-unit offset compiles, is accepted by `queue.writeBuffer`
 * only when it happens to be a multiple of 4, and otherwise leaves the buffer
 * untouched — which is how every point mark disappeared.
 *
 * So these tests replay the very bytes a run carries into a mirror buffer at the
 * offset it names, and read them back through TypeGPU's own reader: a wrong unit
 * or a wrong chunk cannot survive that.
 */

/** A record small enough to read the byte arithmetic off: 8 bytes. */
const Pair = struct({ x: f32, y: f32 });
type PairValue = ReturnType<typeof Pair>;

const CAPACITY = 64;
const STRIDE = sizeOf(arrayOf(Pair, 1));
const CHUNK_BYTES = sizeOf(arrayOf(Pair, CHUNK));
const POOL_BYTES = sizeOf(arrayOf(Pair, CAPACITY));

type PairArgs = { x: number; y: number };

/** The pooled record's payload: the signature and the bytes both come from it. */
function fillPair(record: PairValue, args: PairArgs): void {
  record.x = args.x;
  record.y = args.y;
}

const args = (x: number, y: number): PairArgs => ({ x, y });

function makePool() {
  return createRecordPool({ element: Pair, count: CAPACITY, make: () => Pair({ x: 0, y: 0 }) });
}

/** The staging bytes of a run, read back at their own offsets. Enforces the
 * GPU's rule instead of assuming it: a run that is not chunk-aligned, or not a
 * multiple of 4, throws rather than landing somewhere plausible. */
function replay(runs: readonly ChunkRun[]): PairValue[] {
  const mirror = new ArrayBuffer(POOL_BYTES);
  const bytes = new Uint8Array(mirror);
  for (const run of runs) {
    if (run.startOffset % 4 !== 0) {
      throw new Error(`writeBuffer offset ${run.startOffset} is not a multiple of 4`);
    }
    if (run.startOffset % CHUNK_BYTES !== 0) {
      throw new Error(`writeBuffer offset ${run.startOffset} is not chunk-aligned`);
    }
    bytes.set(run.bytes, run.startOffset);
  }
  return readFromArrayBuffer(mirror, arrayOf(Pair, CAPACITY));
}

describe("record pool staging", () => {
  test("staged bytes land at their own slots", () => {
    const pool = makePool();
    for (let slot = 0; slot < 8; slot++) {
      pool.touch(slot, [slot, slot * 2], fillPair, args(slot, slot * 2));
    }
    const runs: ChunkRun[] = [];
    expect(pool.flush((run) => runs.push(run))).toBe(8);

    // One chunk's worth of soiled slots: one run, at the buffer's start.
    expect(runs).toHaveLength(1);
    const run = runs[0]!;
    expect(run.startOffset).toBe(0);
    expect(run.bytes.byteLength).toBe(CHUNK_BYTES);

    const back = replay(runs);
    for (let slot = 0; slot < 8; slot++) {
      expect(back[slot]!.x).toBe(slot);
      expect(back[slot]!.y).toBe(slot * 2);
    }
    // Nothing outside the run was written, whatever the mirror held before.
    expect(back[16]!.x).toBe(0);
  });

  test("a run carries its clean neighbours' staged bytes", () => {
    // What chunking costs in granularity is also what makes it safe: the mirror
    // holds every record's current bytes, so an unchanged record inside a dirty
    // chunk goes up correct rather than needing to be re-serialized.
    const pool = makePool();
    pool.touch(0, [7, 7], fillPair, args(7, 7));
    pool.flush(() => {});

    const runs: ChunkRun[] = [];
    pool.touch(1, [8, 8], fillPair, args(8, 8));
    expect(pool.flush((run) => runs.push(run))).toBe(1);

    const back = replay(runs);
    expect(back[0]!.x).toBe(7);
    expect(back[1]!.x).toBe(8);
  });

  test("a scattered change costs one run per dirty chunk", () => {
    const pool = makePool();
    pool.touch(3, [1, 1], fillPair, args(1, 1));
    pool.touch(40, [2, 2], fillPair, args(2, 2));
    const runs: ChunkRun[] = [];
    expect(pool.flush((run) => runs.push(run))).toBe(2);

    expect(runs.map((run) => run.startOffset)).toEqual([0, 2 * CHUNK_BYTES]);
    expect(runs.every((run) => run.bytes.byteLength === CHUNK_BYTES)).toBe(true);
    const back = replay(runs);
    expect(back[3]!.x).toBe(1);
    expect(back[40]!.x).toBe(2);
  });

  test("adjacent dirty chunks go up as one run", () => {
    const pool = makePool();
    pool.touch(2, [1, 1], fillPair, args(1, 1));
    pool.touch(20, [2, 2], fillPair, args(2, 2));
    const runs: ChunkRun[] = [];
    pool.flush((run) => runs.push(run));

    expect(runs).toHaveLength(1);
    expect(runs[0]!.startOffset).toBe(0);
    expect(runs[0]!.bytes.byteLength).toBe(2 * CHUNK_BYTES);
  });

  test("an unchanged tick stages nothing", () => {
    const pool = makePool();
    pool.touch(5, [5, 5], fillPair, args(5, 5));
    pool.touch(5, [6, 6], fillPair, args(6, 6));
    expect(pool.flush(() => {})).toBe(2);

    // Same inputs: the fill is never called, no bytes move, no run appears.
    let filled = 0;
    pool.touch(
      5,
      [6, 6],
      (record, payload) => {
        filled++;
        fillPair(record, payload);
      },
      args(0, 0),
    );
    expect(filled).toBe(0);
    const runs: ChunkRun[] = [];
    expect(pool.flush((run) => runs.push(run))).toBe(0);
    expect(runs).toHaveLength(0);
    // The pooled record still holds the last staged values.
    expect(pool.recordAt(5)!.x).toBe(6);
  });

  test("a retired slot stages again whatever its inputs", () => {
    // The slot may be another key's by now, so "the bytes there are this key's"
    // stops being true the moment the run is released.
    const pool = makePool();
    pool.touch(9, [1, 2], fillPair, args(1, 2));
    pool.flush(() => {});

    pool.touch(9, [1, 2], fillPair, args(1, 2));
    expect(pool.flush(() => {})).toBe(0);

    pool.retire(9);
    pool.touch(9, [1, 2], fillPair, args(1, 2));
    const runs: ChunkRun[] = [];
    expect(pool.flush((run) => runs.push(run))).toBe(1);

    const back = replay(runs);
    expect(back[9]!.x).toBe(1);
    expect(back[9]!.y).toBe(2);
  });

  test("chunking is the schema's own numbers, and the stride divides them", () => {
    // The whole reason a byte offset is safe to derive here: a chunk is the
    // `sizeOf` of the very shapes the buffer was laid out with.
    expect(CHUNK_BYTES).toBe(CHUNK * STRIDE);
    expect(POOL_BYTES).toBe(CAPACITY * STRIDE);
    const strokeStride = sizeOf(arrayOf(StrokeDraw, 1));
    expect(sizeOf(arrayOf(StrokeDraw, CHUNK))).toBe(CHUNK * strokeStride);
    expect(CHUNK_BYTES % 4).toBe(0);
  });
});

/**
 * The trap the pool is written around, pinned so that the comment in
 * `recordPool.ts` cannot quietly stop being true: `calculateOffsets` clamps
 * `endOffset` to `sizeOf(schema)`, so the *element* form of
 * `writeToArrayBuffer` writes **nothing** at a non-zero offset — no throw, no
 * short write, just a record that never reaches the staging mirror. A record is
 * therefore always carried in a one-element array of the array schema.
 */
describe("the element-schema write trap", () => {
  test("the element form writes nothing at an offset; the array form lands", () => {
    const element = new ArrayBuffer(POOL_BYTES);
    writeToArrayBuffer(element, Pair, Pair({ x: 5, y: 5 }), { startOffset: 3 * STRIDE });
    expect(readFromArrayBuffer(element, arrayOf(Pair, CAPACITY))[3]!.x).toBe(0);

    const array = new ArrayBuffer(POOL_BYTES);
    writeToArrayBuffer(array, arrayOf(Pair, CAPACITY), [Pair({ x: 5, y: 5 })], {
      startOffset: 3 * STRIDE,
    });
    expect(readFromArrayBuffer(array, arrayOf(Pair, CAPACITY))[3]!.x).toBe(5);
  });
});
