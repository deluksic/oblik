import { describe, expect, test } from "vitest";

import { createSlotPool } from "./slots";

/**
 * The pool hands out contiguous runs keyed by node key, reusing freed ranges
 * first-fit. Records cache those runs across ticks, so what a run means — and
 * what "reset" restores — is load-bearing.
 */
describe("slot pool", () => {
  test("keeps a key's run across ticks and hands freed ones out again", () => {
    const pool = createSlotPool(10);
    expect(pool.alloc("a", 3)).toBe(0);
    expect(pool.alloc("b", 2)).toBe(3);
    expect(pool.alloc("a", 3)).toBe(0); // kept
    pool.sync(new Set(["a"])); // b leaves
    expect(pool.used).toBe(3);
    expect(pool.alloc("c", 2)).toBe(3); // first-fit reuses b's run
  });

  test("reset returns the pool to its initial state", () => {
    const pool = createSlotPool(10);
    pool.alloc("a", 4);
    pool.alloc("b", 6);
    expect(pool.used).toBe(10);
    expect(pool.alloc("c", 1)).toBeUndefined(); // full

    pool.reset();
    expect(pool.used).toBe(0);
    // The capacity is available again — reset must restore the free run, not
    // just forget the keys.
    expect(pool.alloc("c", 10)).toBe(0);
  });
});
