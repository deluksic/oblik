import { describe, expect, test } from "vitest";

import type { TraceNode } from "../eval/context";
import type { ImageValue } from "../eval/image";
import { applyImageLeaves, withImageOverride } from "./imageOverride";

const value: ImageValue = {
  kind: "image",
  src: "/assets/ref.png",
  world: { x: 0, y: 10 },
  anchor: { x: 20, y: 10 },
  imageSize: { width: 40, height: 20 },
  targetSize: { width: 20 },
  rot: 0,
  flip: 0,
  style: { opacity: 1, saturation: 1, contrast: 1 },
};

function node(v: ImageValue, id = "o_img", occ = 0): TraceNode {
  return { id, occ, kind: "image", value: v, editable: false, stack: [] } as TraceNode;
}

describe("applyImageLeaves", () => {
  test("applies only the leaves it is given", () => {
    const next = applyImageLeaves(value, { "style.saturation": 0.2 });
    expect(next.style).toEqual({ opacity: 1, saturation: 0.2, contrast: 1 });
    expect(next.world).toEqual(value.world);
    expect(next.targetSize).toEqual({ width: 20 });
  });

  test("a stated target side is added beside the one the node already has", () => {
    expect(applyImageLeaves(value, { "targetSize.height": 30 }).targetSize).toEqual({
      width: 20,
      height: 30,
    });
    expect(applyImageLeaves(value, { "targetSize.width": 5 }).targetSize).toEqual({ width: 5 });
  });

  test("rot and flip go through the same normalisation the constructor uses", () => {
    expect(applyImageLeaves(value, { rot: 450 }).rot).toBe(90);
    expect(applyImageLeaves(value, { flip: 2 }).flip).toBe(1);
    expect(applyImageLeaves(value, { flip: 0 }).flip).toBe(0);
  });

  test("world, anchor and the source can move too", () => {
    const next = applyImageLeaves(value, { "world.x": 3, src: "/assets/other.png" });
    expect(next.world).toEqual({ x: 3, y: 10 });
    expect(next.src).toBe("/assets/other.png");
  });
});

describe("withImageOverride", () => {
  const trace = [node(value), node(value, "o_other")];

  test("swaps the node's value and leaves every other node alone", () => {
    const previewed = applyImageLeaves(value, { "world.x": 3 });
    const out = withImageOverride(trace, { id: "o_img", occ: 0, from: value, value: previewed });
    expect(out[0]!.value).toBe(previewed);
    expect(out[1]).toBe(trace[1]);
    // The node itself is a copy: the tape's identity-keyed reuse is untouched.
    expect(out[0]).not.toBe(trace[0]);
    expect(out[0]!.id).toBe("o_img");
  });

  test("keys on id *and* occurrence", () => {
    const previewed = applyImageLeaves(value, { "world.x": 3 });
    const out = withImageOverride([node(value, "o_img", 1)], {
      id: "o_img",
      occ: 0,
      from: value,
      value: previewed,
    });
    expect(out[0]!.value).toBe(value);
  });

  /**
   * The override clears itself: once the evaluated value matches what was
   * previewed, the source has caught up and there is nothing left to override.
   * That is what keeps a slow patch from flashing the old value back.
   */
  test("hands back the untouched node once the source agrees", () => {
    const previewed = applyImageLeaves(value, { "world.x": 3 });
    const same = node(previewed);
    // Not a copy: the very same node, so the adapter's byte-diff sees nothing.
    expect(
      withImageOverride([same], { id: "o_img", occ: 0, from: value, value: previewed })[0],
    ).toBe(same);
  });

  /**
   * A preview reports one node it was taken from, so it must not outlive it. The
   * reference can be re-tied to a point in the file, or that point can move:
   * either way the evaluated value changes under a live preview, and the source
   * is the truth — without this, the picture keeps the previewed placement and
   * ignores the point until the next reload.
   */
  test("a source that moved on is not masked by an old preview", () => {
    const previewed = applyImageLeaves(value, { "world.x": 3 });
    const moved = applyImageLeaves(value, { "world.x": 9 });
    const out = withImageOverride([node(moved)], {
      id: "o_img",
      occ: 0,
      from: value,
      value: previewed,
    });
    expect(out[0]!.value).toBe(moved);
  });

  test("no override, or a node that is not a reference, is a pass-through", () => {
    expect(withImageOverride(trace, undefined)).toBe(trace);
    const point = {
      id: "o_p",
      occ: 0,
      kind: "point",
      value: { kind: "point", x: 0, y: 0 },
      editable: false,
      stack: [],
    } as TraceNode;
    expect(withImageOverride([point], { id: "o_p", occ: 0, from: value, value })[0]).toBe(point);
  });
});
