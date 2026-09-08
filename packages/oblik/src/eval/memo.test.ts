import { describe, expect, test } from "vitest";

import { circle, point, pointOnSegment, segment, slider, style, paint } from "./constructors";
import { evaluate } from "./evaluate";
import { memo, newEvalMemo, sameFingerprint, sweepMemo, type EvalMemo } from "./memo";
import { defineScene } from "./scene";

function leg(x: number, id: string) {
  return point(x, 0, id);
}

function buildLoop(n: number) {
  return defineScene({
    kind: "euclid2",
    title: "t",
    build() {
      for (let i = 0; i < n; i++) {
        circle({ x: i, y: 0 }, 1, "ring");
      }
    },
  });
}

function chainScene() {
  return defineScene({
    kind: "euclid2",
    title: "t",
    build() {
      const A = point(0, 0, "a");
      const B = point(4, 0, "b");
      const s = segment(A, B, "s");
      const g = pointOnSegment(s, 0.25, "g");
      const c = circle(g, 1, "c");
      return { A, B, s, g, c };
    },
  });
}

describe("sameFingerprint", () => {
  test("primitives, plain objects, and arrays compare by value", () => {
    expect(sameFingerprint([1, { x: 0, y: [1, 2] }], [1, { x: 0, y: [1, 2] }])).toBe(true);
    expect(sameFingerprint([1], [2])).toBe(false);
    expect(sameFingerprint([Number.NaN], [Number.NaN])).toBe(true);
    expect(sameFingerprint([{}], [{ a: 1 }])).toBe(false);
    expect(sameFingerprint([[1, 2]], [[1, 2, 3]])).toBe(false);
  });

  test("distinct objects beyond the depth cap miss, never false-hit", () => {
    const deep = { a: { b: { c: { d: { e: 1 } } } } };
    const deep2 = { a: { b: { c: { d: { e: 1 } } } } };
    expect(sameFingerprint([deep], [deep])).toBe(true); // same reference
    expect(sameFingerprint([deep], [deep2])).toBe(false); // past cap
  });
});

describe("site memoization", () => {
  test("a second eval of the same scene returns the previous value objects", () => {
    const scene = chainScene();
    const memoStore = newEvalMemo();
    const r1 = evaluate(scene, { memo: memoStore });
    expect(r1.stats).toEqual({ built: 5, hits: 0 });
    const r2 = evaluate(scene, { memo: memoStore });
    expect(r2.stats).toEqual({ built: 0, hits: 5 });
    expect(r2.trace.map((n) => n.id)).toEqual(r1.trace.map((n) => n.id));
    for (let i = 0; i < r1.trace.length; i++) {
      expect(r2.trace[i]).toBe(r1.trace[i]);
      expect(r2.trace[i]?.value).toBe(r1.trace[i]?.value);
    }
  });

  test("identity propagates along a chain from a single changed leaf", () => {
    const scene = chainScene();
    const memoStore = newEvalMemo();
    const base = evaluate(scene, { memo: memoStore });
    const bVal = base.trace.find((n) => n.id === "b")?.value;
    const dragged = evaluate(scene, { memo: memoStore, draft: new Map([["a", [1, 1]]]) });
    expect(dragged.stats).toEqual({ built: 4, hits: 1 }); // a, s, g, c rebuild; B hits
    expect(dragged.trace.find((n) => n.id === "b")?.value).toBe(bVal);
    const gc = dragged.trace.find((n) => n.id === "c")?.value;
    // g = pointOnSegment((1,1)→(4,0), 0.25) = (1.75, 0.75)
    expect(gc?.kind === "circle" ? gc.center.x : undefined).toBeCloseTo(1.75);
  });

  test("clearing the draft rebuilds the frontier; values stay correct", () => {
    const scene = chainScene();
    const memoStore = newEvalMemo();
    evaluate(scene, { memo: memoStore });
    evaluate(scene, { memo: memoStore, draft: new Map([["a", [1, 1]]]) });
    const back = evaluate(scene, { memo: memoStore });
    const a = back.trace.find((n) => n.id === "a")?.value;
    expect(a?.kind === "point" ? a.x : undefined).toBe(0);
  });

  test("a fresh memo misses everything (mod-swap invalidation path)", () => {
    const scene = chainScene();
    const m1 = newEvalMemo();
    evaluate(scene, { memo: m1 });
    const r2 = evaluate(scene, { memo: newEvalMemo() });
    expect(r2.stats).toEqual({ built: 5, hits: 0 });
    expect(m1.entries.size).toBe(5);
  });

  test("a thrown build leaves the cache untouched", () => {
    let shouldThrow = false;
    const scene = defineScene({
      kind: "euclid2",
      title: "t",
      build() {
        if (shouldThrow) throw new Error("boom");
        const A = point(0, 0, "a");
        return circle(A, 1, "c");
      },
    });
    const memoStore = newEvalMemo();
    evaluate(scene, { memo: memoStore });
    shouldThrow = true;
    expect(() => evaluate(scene, { memo: memoStore })).toThrow("boom");
    shouldThrow = false;
    const ok = evaluate(scene, { memo: memoStore });
    expect(ok.stats).toEqual({ built: 0, hits: 2 });
  });

  test("same id through multiple call sites keeps per-occ entries", () => {
    const scene = defineScene({
      kind: "euclid2",
      title: "t",
      build() {
        leg(1, "h");
        leg(2, "h");
      },
    });
    const memoStore = newEvalMemo();
    const r1 = evaluate(scene, { memo: memoStore });
    expect(r1.stats).toEqual({ built: 2, hits: 0 });
    const r2 = evaluate(scene, { memo: memoStore });
    expect(r2.stats).toEqual({ built: 0, hits: 2 });
    expect(r2.trace[0]?.value).toBe(r1.trace[0]?.value);
    expect(r2.trace[1]?.value).toBe(r1.trace[1]?.value);
  });

  test("occ shifts when a loop shrinks; sweep prunes dead occurrences", () => {
    const memoStore: EvalMemo = newEvalMemo();
    evaluate(buildLoop(3), { memo: memoStore });
    expect(memoStore.entries.size).toBe(3);
    const small = evaluate(buildLoop(2), { memo: memoStore });
    expect(small.stats.hits).toBe(2);
    expect(small.stats.built).toBe(0);
    expect(memoStore.entries.size).toBe(2); // ring:2 swept after the successful eval
  });

  test("sweepMemo drops stale entries", () => {
    const m = newEvalMemo();
    m.entries.set("ring:0", {
      fingerprint: [],
      value: { kind: "circle", center: { x: 0, y: 0 }, radius: 1 },
      node: {
        id: "ring",
        occ: 0,
        kind: "circle",
        value: { kind: "circle", center: { x: 0, y: 0 }, radius: 1 },
        editable: false,
        stack: [],
      },
    });
    sweepMemo(m, new Map([["ring", 1]]));
    expect(m.entries.size).toBe(1);
    sweepMemo(m, new Map([["ring", 0]]));
    expect(m.entries.size).toBe(0);
  });

  test("without a memo, evals pass through uncached", () => {
    const scene = chainScene();
    const r1 = evaluate(scene);
    const r2 = evaluate(scene);
    expect(r1.stats).toEqual({ built: 0, hits: 0 });
    expect(r2.stats).toEqual({ built: 0, hits: 0 });
    expect(r2.trace[0]?.value).not.toBe(r1.trace[0]?.value);
  });

  test("slider, style, and paint flow through fingerprinting", () => {
    const scene = defineScene({
      kind: "figure",
      title: "t",
      build() {
        const A = point(0, 0, "a");
        const s = style({ stroke: "#111", width: 1 }, "s");
        const p = paint(A, s, "p");
        const v = slider(0.5, { min: 0, max: 1 }, "v");
        return { p, v };
      },
    });
    const memoStore = newEvalMemo();
    const r1 = evaluate(scene, { memo: memoStore });
    // slider returns a bare number — never cached, always rebuilt, never counted.
    expect(r1.stats).toEqual({ built: 3, hits: 0 });
    const r2 = evaluate(scene, { memo: memoStore });
    expect(r2.stats).toEqual({ built: 0, hits: 3 });
    const dragged = evaluate(scene, { memo: memoStore, draft: new Map([["a", [2, 2]]]) });
    // a and p rebuild (paint target identity changed); s hits.
    expect(dragged.stats).toEqual({ built: 2, hits: 1 });
  });
});

describe("memo(fn)", () => {
  test("hits by args and returns the previous result object", () => {
    let calls = 0;
    const grid = memo((i: number, j: number) => {
      calls++;
      return { x: i, y: j };
    });
    const scene = defineScene({
      kind: "euclid2",
      title: "t",
      build() {
        grid(1, 2);
        grid(3, 4);
        grid(1, 2);
      },
    });
    const r1 = evaluate(scene);
    // occ-keyed: the third call is its own slot, so all three build.
    expect(calls).toBe(3);
    expect(r1.stats).toEqual({ built: 3, hits: 0 });
    const r2 = evaluate(scene);
    expect(calls).toBe(3);
    expect(r2.stats).toEqual({ built: 0, hits: 3 });
  });

  test("branded args compare by identity, so a moved point invalidates", () => {
    const noisy = memo((p: { x: number; y: number }) => ({ at: p }));
    const scene = defineScene({
      kind: "euclid2",
      title: "t",
      build() {
        const A = point(0, 0, "a");
        return noisy(A);
      },
    });
    const memoStore = newEvalMemo();
    const r1 = evaluate(scene, { memo: memoStore });
    expect(r1.stats).toEqual({ built: 2, hits: 0 }); // point + memo call
    const dragged = evaluate(scene, { memo: memoStore, draft: new Map([["a", [1, 0]]]) });
    expect(dragged.stats).toEqual({ built: 2, hits: 0 });
    const settled = evaluate(scene, { memo: memoStore, draft: new Map([["a", [1, 0]]]) });
    expect(settled.stats).toEqual({ built: 0, hits: 2 });
  });

  test("a new fn object (HMR re-import) invalidates", () => {
    let calls = 0;
    const makeGrid = () =>
      memo((i: number) => {
        calls++;
        return { i };
      });
    let grid = makeGrid();
    const scene = defineScene({
      kind: "euclid2",
      title: "t",
      build() {
        grid(1);
      },
    });
    evaluate(scene);
    expect(calls).toBe(1);
    grid = makeGrid(); // fresh fn object, same source
    evaluate(scene);
    expect(calls).toBe(2);
  });
});
