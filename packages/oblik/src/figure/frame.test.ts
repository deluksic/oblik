import { describe, expect, test } from "vitest";

import { frameMoved, frameRect, frameResized, pageScreenRect } from "./frame";

describe("frameRect", () => {
  test("centers on the look-at", () => {
    expect(frameRect({ width: 5.2, height: 4.2 }, { x: 2, y: 1.6 })).toEqual({
      x: 2 - 2.6,
      y: 1.6 - 2.1,
      w: 5.2,
      h: 4.2,
    });
  });

  test("omits empty frames", () => {
    expect(frameRect(undefined, { x: 0, y: 0 })).toBeUndefined();
    expect(frameRect({ width: 0, height: 4 }, { x: 0, y: 0 })).toBeUndefined();
  });
});

describe("frameMoved", () => {
  test("translates by the world delta", () => {
    const start = { x: 1, y: 2, width: 4, height: 3 };
    expect(frameMoved(start, { x: 0, y: 0 }, { x: 0.5, y: -1 })).toEqual({
      x: 1.5,
      y: 1,
      width: 4,
      height: 3,
    });
  });
});

describe("frameResized", () => {
  test("keeps the anchor and grows toward the dragged corner", () => {
    expect(frameResized({ x: 1, y: 2 }, { x: 6, y: 7 })).toEqual({
      x: 1,
      y: 2,
      width: 5,
      height: 5,
    });
  });

  test("clamps to a minimum size", () => {
    expect(frameResized({ x: 0, y: 0 }, { x: -2, y: 0.1 }, 0.25)).toEqual({
      x: 0,
      y: 0,
      width: 0.25,
      height: 0.25,
    });
  });
});

describe("pageScreenRect", () => {
  test("maps the world page onto pane pixels", () => {
    const page = { x: 0, y: 0, w: 4, h: 3 };
    const cam = { x: 2, y: 1.5, scale: 50 };
    const size = { w: 800, h: 600 };
    const box = pageScreenRect(page, cam, size);
    expect(box.left).toBeCloseTo(300, 8);
    expect(box.top).toBeCloseTo(225, 8);
    expect(box.width).toBeCloseTo(200, 8);
    expect(box.height).toBeCloseTo(150, 8);
  });
});
