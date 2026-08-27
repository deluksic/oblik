import { describe, expect, test } from "vitest";

import { frameRect, pageScreenRect } from "./frame";

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
    expect(frameRect(undefined, { x: 0, y: 0 })).toBeNull();
    expect(frameRect({ width: 0, height: 4 }, { x: 0, y: 0 })).toBeNull();
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
