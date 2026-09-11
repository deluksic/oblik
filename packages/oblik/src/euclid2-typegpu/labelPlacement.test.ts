import { describe, expect, test } from "vitest";

import type { TraceValue } from "#eval/context";
import type { TraceNode } from "#eval/context";

import {
  LABEL_BASELINE_PX,
  LABEL_DX,
  LABEL_DY,
  isBindLabelNode,
  labelAnchor,
  labelBoxAt,
} from "./labelPlacement";

/**
 * Only the fields the label path reads. `kind` is derived from `value`, so the
 * pair is consistent by construction; the assertion states that correlation for
 * a generic `V`.
 */
function node<V extends TraceValue>(value: V, bind?: string): TraceNode {
  return {
    id: "o_a",
    occ: 0,
    kind: value.kind,
    value,
    bind,
    editable: true,
    stack: [],
  } as TraceNode;
}

const POINT = node({ kind: "point", x: 2, y: 3 }, "p");
const GLIDER = node(
  { kind: "gliderSegment", a: { x: 0, y: 0 }, b: { x: 4, y: 0 }, t: 0.5, x: 2, y: 0 },
  "g",
);
const SEGMENT = node({ kind: "segment", a: { x: 0, y: 0 }, b: { x: 4, y: 0 } }, "s");
const SLIDER = node({ kind: "slider", n: 1, min: 0, max: 2, step: 0.1 }, "r");
const NAN_POINT = node({ kind: "point", x: Number.NaN, y: 3 }, "bad");

describe("isBindLabelNode", () => {
  test("named points and gliders carry a label", () => {
    expect(isBindLabelNode(POINT)).toBe(true);
    expect(isBindLabelNode(GLIDER)).toBe(true);
  });

  test("anonymous points carry none", () => {
    expect(isBindLabelNode(node({ kind: "point", x: 2, y: 3 }))).toBe(false);
  });

  test("named non-point geometry carries none — labels ride the point band", () => {
    expect(isBindLabelNode(SEGMENT)).toBe(false);
    expect(isBindLabelNode(SLIDER)).toBe(false);
  });

  test("non-finite points are skipped, like the SVG point band", () => {
    expect(isBindLabelNode(NAN_POINT)).toBe(false);
  });
});

describe("labelAnchor", () => {
  test("resolves points directly and gliders through their carrier", () => {
    expect(labelAnchor(POINT)).toEqual({ x: 2, y: 3 });
    expect(labelAnchor(GLIDER)).toEqual({ x: 2, y: 0 });
  });

  test("has no anchor for other geometry", () => {
    expect(labelAnchor(SEGMENT)).toBeUndefined();
  });
});

describe("labelBoxAt", () => {
  test("offsets the anchor by the SVG text position and lifts to the line-box top", () => {
    expect(labelBoxAt({ x: 100, y: 50 })).toEqual({
      x: 100 + LABEL_DX,
      y: 50 + LABEL_DY - LABEL_BASELINE_PX,
    });
  });

  test("matches the SVG baseline: box top + baseline offset lands on y", () => {
    const box = labelBoxAt({ x: 100, y: 50 });
    expect(box.y + LABEL_BASELINE_PX).toBe(50 + LABEL_DY);
  });
});
