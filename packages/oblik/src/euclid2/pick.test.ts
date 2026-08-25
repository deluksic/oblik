import { describe, expect, test } from "vitest";

import type { TraceNode } from "../eval/context";
import { hitTest, hitsNear, pickAmong, snapBoundPoint, traceKey } from "./pick";

const A = {
  id: "o_a",
  occ: 0,
  kind: "point",
  value: { kind: "point", x: 0, y: 0 },
  bind: "A",
  editable: true,
  stack: [{ file: "scene.ts", line: 10, column: 4, name: "build" }],
} as TraceNode;

const SEG = {
  id: "o_s",
  occ: 0,
  kind: "segment",
  value: { kind: "segment", a: { x: 0, y: 0 }, b: { x: 4, y: 0 } },
  editable: false,
  stack: [{ file: "scene.ts", line: 16, column: 4 }],
} as TraceNode;

const camera = { x: 0, y: 0, scale: 48 };
const size = { w: 800, h: 600 };

describe("snapBoundPoint", () => {
  test("snaps to a named point within range", () => {
    const s = snapBoundPoint([A], { x: 0.1, y: 0 }, 0.3);
    expect(s?.bind).toBe("A");
  });

  test("ignores unbound and far points", () => {
    const far: TraceNode = { ...A, bind: "B", value: { kind: "point", x: 9, y: 9 } };
    const anon: TraceNode = { ...A, bind: undefined, id: "o_z" };
    expect(snapBoundPoint([far, anon], { x: 0, y: 0 }, 0.3)).toBeNull();
  });
});

describe("hitTest", () => {
  test("prefers points over segments at the same location", () => {
    const hit = hitTest([SEG, A], { x: 0, y: 0 }, camera, size);
    expect(hit?.kind).toBe("point");
  });

  test("picks a nearby segment", () => {
    const hit = hitTest([SEG], { x: 2, y: 0.05 }, camera, size);
    expect(hit?.id).toBe("o_s");
  });
});

describe("pickAmong", () => {
  test("first click takes the nearest; re-click cycles the overlap list", () => {
    const dup0: TraceNode = {
      ...A,
      occ: 0,
      stack: [{ file: "scene.ts", line: 8, column: 4 }],
    };
    const dup1: TraceNode = {
      ...A,
      occ: 1,
      stack: [{ file: "scene.ts", line: 12, column: 4 }],
    };
    const hits = hitsNear([dup0, dup1], { x: 0, y: 0 }, camera, size);
    expect(hits).toHaveLength(2);
    const first = pickAmong(hits, null);
    expect(traceKey(first!)).toBe("o_a:0");
    const second = pickAmong(hits, traceKey(first!));
    expect(traceKey(second!)).toBe("o_a:1");
    const third = pickAmong(hits, traceKey(second!));
    expect(traceKey(third!)).toBe("o_a:0");
  });
});
