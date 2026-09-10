import { describe, expect, test } from "vitest";

import type { TraceNodeOf } from "#eval/context";

import {
  chromePasses,
  chromeSplitEqual,
  hoverNode,
  isGrabbable,
  isHot,
  isHover,
  isSelected,
  liftSelected,
  splitChrome,
} from "./marks";

const A: TraceNodeOf<"point"> = {
  id: "o_a",
  occ: 0,
  kind: "point",
  value: { kind: "point", x: 0, y: 0 },
  editable: true,
  stack: [],
};

const A2: TraceNodeOf<"point"> = {
  ...A,
  occ: 1,
  value: { kind: "point", x: 5, y: 0 },
};

const CIRCLE: TraceNodeOf<"circle"> = {
  id: "o_r",
  occ: 0,
  kind: "circle",
  value: { kind: "circle", center: { x: 0, y: 0 }, radius: 2 },
  editable: true,
  stack: [],
};

const SEG: TraceNodeOf<"segment"> = {
  id: "o_s",
  occ: 0,
  kind: "segment",
  value: { kind: "segment", a: { x: 0, y: 0 }, b: { x: 4, y: 0 } },
  editable: false,
  stack: [],
};

const OFFSET: TraceNodeOf<"parallelLine"> = {
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
};

const OFFSET_REGION: TraceNodeOf<"csg2"> = {
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
};

describe("isGrabbable", () => {
  test("editable points, circles, parallel lines, and offset regions", () => {
    expect(isGrabbable(A)).toBe(true);
    expect(isGrabbable(CIRCLE)).toBe(true);
    expect(isGrabbable(OFFSET)).toBe(true);
    expect(isGrabbable(OFFSET_REGION)).toBe(true);
    expect(isGrabbable(SEG)).toBe(false);
    expect(isGrabbable({ ...A, editable: false })).toBe(false);
    expect(isGrabbable({ ...OFFSET_REGION, editable: false })).toBe(false);
    expect(isGrabbable(undefined)).toBe(false);
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

  test("keeps item identity so For can reuse nodes across splits", () => {
    const a = { id: "a" };
    const b = { id: "b" };
    const idle = splitChrome(
      [a, b],
      () => false,
      () => false,
    );
    const hoverB = splitChrome(
      [a, b],
      () => false,
      (x) => x.id === "b",
    );
    expect(idle.rest[0]).toBe(a);
    expect(hoverB.rest[0]).toBe(a);
    expect(hoverB.hover[0]).toBe(b);
    expect(chromeSplitEqual(idle, idle)).toBe(true);
    expect(
      chromeSplitEqual(
        idle,
        splitChrome(
          [a, b],
          () => false,
          () => false,
        ),
      ),
    ).toBe(true);
    expect(chromeSplitEqual(idle, hoverB)).toBe(false);
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

  test("allocates new pass objects each call", () => {
    const band = splitChrome(
      ["a"],
      () => false,
      () => false,
    );
    expect(chromePasses(band)[0]).not.toBe(chromePasses(band)[0]);
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
  test("resolves the live node for a hover key", () => {
    expect(hoverNode([SEG, CIRCLE, A], "o_r:0")?.kind).toBe("circle");
    expect(isGrabbable(hoverNode([SEG, CIRCLE, A], "o_r:0"))).toBe(true);
    expect(isGrabbable(hoverNode([SEG, CIRCLE, A], "o_s:0"))).toBe(false);
    expect(hoverNode([A], undefined)).toBeUndefined();
  });

  test("hot highlight uses the same key as select", () => {
    expect(isHot(A, "o_a:0", undefined)).toBe(true);
    expect(isHot(CIRCLE, "o_a:0", undefined)).toBe(false);
    expect(isHover(A, "o_a:0", undefined)).toBe(true);
    expect(isHover(A, "o_a:0", "o_a:0")).toBe(false);
    expect(isSelected(A, "o_a:0")).toBe(true);
  });

  test("a repeated id lights up one occurrence at a time", () => {
    expect(isHot(A, "o_a:1", undefined)).toBe(false);
    expect(isHot(A2, "o_a:1", undefined)).toBe(true);
    expect(hoverNode([A, A2], "o_a:1")).toBe(A2);
    expect(isHot(A2, "o_a:0", undefined)).toBe(false);
  });
});
