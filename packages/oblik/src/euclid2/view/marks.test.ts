import { describe, expect, test } from "vitest";

import type { TraceNode } from "@/eval/context";

import {
  chromePasses,
  hoverNode,
  isGrabbable,
  isHot,
  isHover,
  isSelected,
  liftSelected,
  splitChrome,
} from "./marks";

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

const OFFSET = {
  id: "o_par",
  occ: 0,
  kind: "parallelLine",
  value: {
    kind: "parallelLine",
    line: { kind: "line", origin: { x: 0, y: 1.76 }, direction: { x: 1, y: 0 } },
    distance: 1.76,
  },
  editable: true,
  stack: [],
} as TraceNode;

const OFFSET_REGION = {
  id: "o_off",
  occ: 0,
  kind: "csg2",
  value: {
    kind: "csg2",
    op: "union",
    of: [{ kind: "offset", of: { kind: "region", outer: [], holes: [] }, d: -0.2 }],
  },
  editable: true,
  stack: [],
} as TraceNode;

describe("isGrabbable", () => {
  test("editable points, circles, parallel lines, and offset regions", () => {
    expect(isGrabbable(A)).toBe(true);
    expect(isGrabbable(CIRCLE)).toBe(true);
    expect(isGrabbable(OFFSET)).toBe(true);
    expect(isGrabbable(OFFSET_REGION)).toBe(true);
    expect(isGrabbable(SEG)).toBe(false);
    expect(isGrabbable({ ...A, editable: false })).toBe(false);
    expect(isGrabbable({ ...OFFSET_REGION, editable: false })).toBe(false);
    expect(isGrabbable(null)).toBe(false);
  });
});

describe("splitChrome", () => {
  test("peels hover and selected without mixing groups", () => {
    expect(
      splitChrome(
        ["a", "b", "c", "d"],
        (x) => x === "d",
        (x) => x === "b",
      ),
    ).toEqual({
      rest: ["a", "c"],
      hover: ["b"],
      lifted: ["d"],
    });
    expect(
      splitChrome(
        ["a", "b"],
        (x) => x === "b",
        (x) => x === "b",
      ),
    ).toEqual({
      rest: ["a"],
      hover: [],
      lifted: ["b"],
    });
  });
});

describe("chromePasses", () => {
  test("idle then hover overlay+paint then selected overlay+paint", () => {
    const band = splitChrome(
      ["a", "b", "c"],
      (x) => x === "c",
      (x) => x === "b",
    );
    expect(chromePasses(band)).toEqual([
      { items: ["a"] },
      { items: ["b"], overlay: true },
      { items: ["b"] },
      { items: ["c"], overlay: true },
      { items: ["c"] },
    ]);
  });

  test("dragging skips overlay passes and still lifts paint", () => {
    const band = splitChrome(
      ["a", "b", "c"],
      (x) => x === "c",
      (x) => x === "b",
    );
    expect(chromePasses(band, false)).toEqual([
      { items: ["a"] },
      { items: ["b"] },
      { items: ["c"] },
    ]);
  });
});

describe("liftSelected", () => {
  test("moves selected items after the rest, preserving order in each group", () => {
    expect(liftSelected(["a", "b", "c", "d"], (x) => x === "b" || x === "d")).toEqual({
      rest: ["a", "c"],
      lifted: ["b", "d"],
    });
    expect(liftSelected(["a", "b"], () => false)).toEqual({ rest: ["a", "b"], lifted: [] });
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
    expect(isHover(A, "o_a", null)).toBe(true);
    expect(isHover(A, "o_a", "o_a:0")).toBe(false);
    expect(isSelected(A, "o_a:0")).toBe(true);
  });
});
