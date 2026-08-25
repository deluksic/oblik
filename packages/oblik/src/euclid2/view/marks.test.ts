import { describe, expect, test } from "vitest";

import type { TraceNode } from "../../eval/context";
import { hoverNode, isGrabbable, isHot } from "./marks";

const A = {
  id: "o_a",
  occ: 0,
  kind: "point",
  value: { kind: "point", x: 0, y: 0 },
  editable: true,
  stack: [],
} as TraceNode;

const CIRCLE = {
  id: "o_r",
  occ: 0,
  kind: "circle",
  value: { kind: "circle", center: { x: 0, y: 0 }, radius: 2 },
  editable: true,
  stack: [],
} as TraceNode;

const SEG = {
  id: "o_s",
  occ: 0,
  kind: "segment",
  value: { kind: "segment", a: { x: 0, y: 0 }, b: { x: 4, y: 0 } },
  editable: false,
  stack: [],
} as TraceNode;

describe("isGrabbable", () => {
  test("only editable points and circles", () => {
    expect(isGrabbable(A)).toBe(true);
    expect(isGrabbable(CIRCLE)).toBe(true);
    expect(isGrabbable(SEG)).toBe(false);
    expect(isGrabbable({ ...A, editable: false })).toBe(false);
    expect(isGrabbable(null)).toBe(false);
  });
});

describe("hoverNode", () => {
  test("resolves the live node for a hover id", () => {
    expect(hoverNode([SEG, CIRCLE, A], "o_r")?.kind).toBe("circle");
    expect(isGrabbable(hoverNode([SEG, CIRCLE, A], "o_r"))).toBe(true);
    expect(isGrabbable(hoverNode([SEG, CIRCLE, A], "o_s"))).toBe(false);
    expect(hoverNode([A], null)).toBeNull();
  });

  test("hot highlight uses the same id", () => {
    expect(isHot(A, "o_a", null)).toBe(true);
    expect(isHot(CIRCLE, "o_a", null)).toBe(false);
  });
});
