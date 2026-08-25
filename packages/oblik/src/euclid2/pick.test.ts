import { describe, expect, test } from "vitest";

import type { TraceNode } from "../eval/context";
import { snapBoundPoint } from "./pick";

const A = {
  id: "o_a",
  occ: 0,
  kind: "point",
  value: { kind: "point", x: 0, y: 0 },
  bind: "A",
  editable: true,
  stack: [],
} as TraceNode;

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
