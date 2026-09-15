import { readFromArrayBuffer, writeToArrayBuffer } from "typegpu";
import { arrayOf, f32, sizeOf, struct } from "typegpu/data";
import { describe, expect, test } from "vitest";

import { createRecordPool, GAP_RECORDS, type RecordRun } from "./recordPool";
import { StrokeNode } from "./schemas";

/**
 * The batch contract, which a GPU error once enforced the hard way: the offset a
 * staged span is written at is a **byte** offset into the record buffer, not a
 * slot index. A wrong-unit offset compiles, and `queue.writeBuffer` accepts it
 * only when it happens to be a multiple of 4 — otherwise it leaves the buffer
 * untouched, which is how every point mark disappeared.
 *
 * So these tests replay the very bytes a span carries into a mirror buffer at the
 * offset it names, and read them back through TypeGPU's own reader: a wrong unit,
 * a wrong slot or a span that swallowed its neighbour cannot survive that.
 *
 * They also pin what the pool is *for*: a frame that changed one record uploads
 * that record — not a neighbourhood, not a buffer-shaped sweep.
 */

/** A record small enough to read the byte arithmetic off: 8 bytes. */
const Pair = struct({ x: f32, y: f32 });
type PairValue = ReturnType<typeof Pair>;

const CAPACITY = 1024;
const STRIDE = sizeOf(arrayOf(Pair, 1));
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

/** The staging bytes of a span, read back at their own offsets. Enforces the
 * GPU's rule instead of assuming it — and that every offset is a whole record,
 * which is the invariant the spans are built from. */
function replay(runs: readonly RecordRun[]): PairValue[] {
  const mirror = new ArrayBuffer(POOL_BYTES);
  const bytes = new Uint8Array(mirror);
  for (const run of runs) {
    if (run.startOffset % 4 !== 0) {
      throw new Error(`writeBuffer offset ${run.startOffset} is not a multiple of 4`);
    }
    if (run.startOffset % STRIDE !== 0) {
      throw new Error(`writeBuffer offset ${run.startOffset} is not a whole record`);
    }
    bytes.set(run.bytes, run.startOffset);
  }
  return readFromArrayBuffer(mirror, arrayOf(Pair, CAPACITY));
}

/** The spans a flush produced, as `[firstSlot, lastSlot]` in records. */
function spans(runs: readonly RecordRun[]): [number, number][] {
  return runs.map((run) => [
    run.startOffset / STRIDE,
    run.startOffset / STRIDE + run.bytes.byteLength / STRIDE - 1,
  ]);
}

describe("record pool staging", () => {
  test("a lone change uploads that record and nothing else", () => {
    const pool = makePool();
    pool.touch(5, [5, 5], fillPair, args(5, 5));
    const runs: RecordRun[] = [];
    expect(pool.flush((run) => runs.push(run))).toBe(1);

    expect(runs).toHaveLength(1);
    expect(spans(runs)).toEqual([[5, 5]]);
    expect(runs[0]!.bytes.byteLength).toBe(STRIDE);
    const back = replay(runs);
    expect(back[5]!.x).toBe(5);
    expect(back[4]!.x).toBe(0);
    expect(back[6]!.x).toBe(0);
  });

  test("a run of changes is one span, and its neighbours' bytes ride along", () => {
    const pool = makePool();
    for (let slot = 0; slot < 8; slot++) {
      pool.touch(slot, [slot, slot * 2], fillPair, args(slot, slot * 2));
    }
    const runs: RecordRun[] = [];
    expect(pool.flush((run) => runs.push(run))).toBe(8);

    expect(spans(runs)).toEqual([[0, 7]]);
    const back = replay(runs);
    for (let slot = 0; slot < 8; slot++) {
      expect(back[slot]!.x).toBe(slot);
      expect(back[slot]!.y).toBe(slot * 2);
    }
  });

  test("a gap is absorbed while it costs less than the call it saves", () => {
    const pool = makePool();
    // The gap between the two spans is `GAP_RECORDS - 1` records: cheaper to
    // copy than to open a second write.
    pool.touch(10, [1, 1], fillPair, args(1, 1));
    pool.touch(10 + GAP_RECORDS, [2, 2], fillPair, args(2, 2));
    const runs: RecordRun[] = [];
    expect(pool.flush((run) => runs.push(run))).toBe(2);

    expect(spans(runs)).toEqual([[10, 10 + GAP_RECORDS]]);
    const back = replay(runs);
    expect(back[10]!.x).toBe(1);
    expect(back[10 + GAP_RECORDS]!.x).toBe(2);
  });

  test("a wider gap is its own write, with no bytes wasted at either end", () => {
    const pool = makePool();
    pool.touch(0, [1, 1], fillPair, args(1, 1));
    pool.touch(GAP_RECORDS * 4, [2, 2], fillPair, args(2, 2));
    const runs: RecordRun[] = [];
    expect(pool.flush((run) => runs.push(run))).toBe(2);

    expect(spans(runs)).toEqual([
      [0, 0],
      [GAP_RECORDS * 4, GAP_RECORDS * 4],
    ]);
    expect(runs.every((run) => run.bytes.byteLength === STRIDE)).toBe(true);
    const back = replay(runs);
    expect(back[0]!.x).toBe(1);
    expect(back[GAP_RECORDS * 4]!.x).toBe(2);
  });

  test("an edit between two spans joins them into one", () => {
    const pool = makePool();
    pool.touch(0, [1, 1], fillPair, args(1, 1));
    pool.touch(199, [2, 2], fillPair, args(2, 2));
    // 100 is within the gap threshold of both sides, so the three become one.
    pool.touch(100, [3, 3], fillPair, args(3, 3));
    const runs: RecordRun[] = [];
    expect(pool.flush((run) => runs.push(run))).toBe(3);

    expect(spans(runs)).toEqual([[0, 199]]);
    const back = replay(runs);
    expect(back[0]!.x).toBe(1);
    expect(back[100]!.x).toBe(3);
    expect(back[199]!.x).toBe(2);
  });

  test("an edit out of buffer order still lands in buffer order", () => {
    // Nodes are usually visited in slot order, but a node that comes back to an
    // earlier slot — an undo, a scene switch — must not leave the spans unsorted.
    const pool = makePool();
    pool.touch(400, [1, 1], fillPair, args(1, 1));
    pool.touch(0, [2, 2], fillPair, args(2, 2));
    pool.touch(GAP_RECORDS * 4, [3, 3], fillPair, args(3, 3));
    const runs: RecordRun[] = [];
    pool.flush((run) => runs.push(run));

    const order = spans(runs).map(([first]) => first);
    expect(order).toEqual([...order].toSorted((a, b) => a - b));
    const back = replay(runs);
    expect(back[0]!.x).toBe(2);
    expect(back[400]!.x).toBe(1);
    expect(back[GAP_RECORDS * 4]!.x).toBe(3);
  });

  test("a span carries the mirror's bytes for records it did not touch", () => {
    // The mirror is the authority for every record, not only for this frame's:
    // a record staged when the scene loaded and then swallowed by a span that
    // absorbed a gap has to go up with its own bytes rather than as a hole. That
    // is what makes absorbing a gap safe at all.
    const pool = makePool();
    pool.touch(10, [7, 7], fillPair, args(7, 7));
    pool.flush(() => {});

    // Two edits close enough to merge, with the load-time record between them.
    const runs: RecordRun[] = [];
    pool.touch(0, [1, 1], fillPair, args(1, 1));
    pool.touch(20, [2, 2], fillPair, args(2, 2));
    expect(pool.flush((run) => runs.push(run))).toBe(2);

    expect(spans(runs)).toEqual([[0, 20]]);
    const back = replay(runs);
    expect(back[0]!.x).toBe(1);
    expect(back[10]!.x).toBe(7); // never touched this frame; the mirror's bytes
    expect(back[20]!.x).toBe(2);
  });

  test("an unchanged tick stages nothing", () => {
    const pool = makePool();
    pool.touch(5, [5, 5], fillPair, args(5, 5));
    pool.touch(5, [6, 6], fillPair, args(6, 6));
    expect(pool.flush(() => {})).toBe(2);

    // Same inputs: the fill is never called, no bytes move, no span appears.
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
    const runs: RecordRun[] = [];
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
    const runs: RecordRun[] = [];
    expect(pool.flush((run) => runs.push(run))).toBe(1);
    expect(spans(runs)).toEqual([[9, 9]]);
  });

  test("a slot outside the pool is loud, not a write that never happens", () => {
    // The two pools' capacities have to agree; a slot past the end would be
    // dropped by the typed arrays and the record would simply never reach the
    // buffer.
    const pool = makePool();
    expect(() => pool.touch(CAPACITY, [1, 2], fillPair, args(1, 2))).toThrow(/outside/);
  });

  test("the byte numbers come from the schema the buffer is laid out as", () => {
    expect(POOL_BYTES).toBe(CAPACITY * STRIDE);
    const strokeStride = sizeOf(arrayOf(StrokeNode, 1));
    expect(sizeOf(arrayOf(StrokeNode, 64))).toBe(64 * strokeStride);
    expect(STRIDE % 4).toBe(0);
  });
});

/**
 * The trap the pool is written around, pinned so that the comment in
 * `recordPool.ts` cannot quietly stop being true: `calculateOffsets` clamps
 * `endOffset` to `sizeOf(schema)`, so the *element* form of `writeToArrayBuffer`
 * writes **nothing** at a non-zero offset — no throw, no short write, just a
 * record that never reaches the staging mirror. A record is therefore always
 * carried in a one-element array of the array schema.
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
