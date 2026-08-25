import { describe, expect, test } from "vitest";

import type { TraceNode } from "../eval/context";
import { hitTest, hitsNear, snapBoundPoint } from "./pick";

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

  test("prefers points over overlapping circle and line", () => {
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
    expect(hits[0]?.id).toBe("o_p");
  });
});
