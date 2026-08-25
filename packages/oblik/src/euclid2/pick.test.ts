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

  test("keeps endpoint points in range when the click is closer to the stroke", () => {
    const hit = hitTest([SEG, A], { x: 0.09, y: 0.04 }, camera, size);
    expect(hit?.kind).toBe("point");
  });
});

describe("pickAmong", () => {
  test("re-click cycles occ for the same id", () => {
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

  test("does not cycle onto overlapping geometry with a different id", () => {
    const s0: TraceNode = { ...SEG, occ: 0 };
    const s1: TraceNode = {
      ...SEG,
      occ: 1,
      stack: [{ file: "scene.ts", line: 20, column: 4 }],
    };
    const hits = hitsNear([s0, s1, A], { x: 0, y: 0 }, camera, size);
    const first = pickAmong(hits, null);
    expect(first?.id).toBe("o_a");
    expect(pickAmong(hits, traceKey(first!))?.id).toBe("o_a");
    const segs = pickAmong([s0, s1], null);
    expect(traceKey(segs!)).toBe("o_s:0");
    expect(traceKey(pickAmong([s0, s1], traceKey(segs!))!)).toBe("o_s:1");
  });

  test("re-click on selected ink cycles to a point on top of it", () => {
    const P = {
      ...A,
      id: "o_p",
      bind: "P",
      value: { kind: "point", x: 2, y: 0 },
    } as TraceNode;
    const CIRCLE = {
      id: "o_c",
      occ: 0,
      kind: "circle",
      value: { kind: "circle", center: { x: 0, y: 0 }, radius: 2 },
      editable: true,
      stack: [{ file: "scene.ts", line: 14, column: 4 }],
    } as TraceNode;
    const hits = hitsNear([CIRCLE, P], { x: 2, y: 0 }, camera, size);
    expect(hits[0]?.id).toBe("o_p");
    const picked = pickAmong(hits, traceKey(CIRCLE));
    expect(picked?.id).toBe("o_p");
  });

  test("points win over overlapping ink even when another kind is selected", () => {
    const P = {
      ...A,
      id: "o_p",
      bind: "P",
      value: { kind: "point", x: 2, y: 0 },
    } as TraceNode;
    const CIRCLE = {
      id: "o_c",
      occ: 0,
      kind: "circle",
      value: { kind: "circle", center: { x: 0, y: 0 }, radius: 2 },
      editable: false,
      stack: [{ file: "scene.ts", line: 14, column: 4 }],
    } as TraceNode;
    const LINE = {
      id: "o_l",
      occ: 0,
      kind: "line",
      value: { kind: "line", origin: { x: 0, y: 0 }, direction: { x: 1, y: 0 } },
      editable: false,
      stack: [{ file: "scene.ts", line: 12, column: 4 }],
    } as TraceNode;
    const hits = hitsNear([CIRCLE, LINE, P], { x: 2, y: 0 }, camera, size);
    expect(pickAmong(hits, traceKey(LINE))?.id).toBe("o_p");
    expect(pickAmong(hits, traceKey(CIRCLE))?.id).toBe("o_p");
  });
});
