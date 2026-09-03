import { describe, expect, test } from "vitest";

import type { TraceNode } from "./context";
import { reusePaintStrokes, reuseUnchangedTrace, sameDrawNode } from "./reuse-trace";

function point(id: string, x: number, y = 0, occ = 0): TraceNode {
  return {
    id,
    occ,
    kind: "point",
    value: { kind: "point", x, y },
    editable: true,
    stack: [{ file: "scene.ts", line: 1, column: 1 }],
  };
}

describe("reuseUnchangedTrace", () => {
  test("keeps object identity when drawable payload is unchanged", () => {
    const prev = [point("o_a", 1, 2)];
    const next = [point("o_a", 1, 2)];
    next[0]!.stack = [{ file: "other.ts", line: 9, column: 2 }];
    const out = reuseUnchangedTrace(prev, next);
    expect(out).toBe(prev);
    expect(out[0]).toBe(prev[0]);
  });

  test("replaces a node whose geometry moved", () => {
    const prev = [point("o_a", 1, 2), point("o_b", 3, 4)];
    const next = [point("o_a", 1, 2), point("o_b", 5, 4)];
    const out = reuseUnchangedTrace(prev, next);
    expect(out[0]).toBe(prev[0]);
    expect(out[1]).toBe(next[1]);
    expect(out).not.toBe(prev);
  });

  test("does not reuse when bind or editable changes", () => {
    const prev = [point("o_a", 1, 2)];
    const next = [{ ...point("o_a", 1, 2), bind: "A" }];
    expect(reuseUnchangedTrace(prev, next)[0]).toBe(next[0]);
    expect(sameDrawNode(prev[0]!, { ...prev[0]!, editable: false })).toBe(false);
  });

  test("reusePaintStrokes keeps wrappers when paint, geom, and style match", () => {
    const geom = point("o_a", 1, 2);
    const paint = {
      id: "o_p",
      occ: 0,
      kind: "paint",
      value: { kind: "paint", targets: [{ id: "o_a", occ: 0 }], style: { kind: "style", stroke: "#000" } },
      editable: false,
      stack: [],
    } as TraceNode;
    const style = { kind: "style" as const, stroke: "#000" };
    const prev = [{ paint, geom, style }];
    const next = [{ paint, geom, style: { kind: "style" as const, stroke: "#000" } }];
    expect(reusePaintStrokes(prev, next)).toBe(prev);
  });
});
