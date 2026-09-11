import { describe, expect, test } from "vitest";

import { boxFromEntry, boxFromRect } from "./elementBox";

const entry = (opts: {
  device?: { inlineSize: number; blockSize: number };
  content?: { inlineSize: number; blockSize: number };
}): ResizeObserverEntry =>
  ({
    devicePixelContentBoxSize: opts.device ? [opts.device] : undefined,
    contentBoxSize: opts.content ? [opts.content] : undefined,
  }) as unknown as ResizeObserverEntry;

const element = (width: number, height: number): Element =>
  ({ getBoundingClientRect: () => ({ width, height }) }) as unknown as Element;

describe("boxFromEntry", () => {
  test("reports the exact device box and the CSS box side by side", () => {
    const box = boxFromEntry(
      entry({
        device: { inlineSize: 1200, blockSize: 900 },
        content: { inlineSize: 800, blockSize: 600 },
      }),
      2,
    );
    expect(box).toEqual({ logical: { w: 800, h: 600 }, physical: { w: 1200, h: 900 } });
  });

  /**
   * The fallback the utility exists for: a browser without
   * `devicePixelContentBoxSize` still reports a device box, from the CSS one.
   */
  test("an entry with no device box scales the CSS box by the ratio", () => {
    const box = boxFromEntry(entry({ content: { inlineSize: 801, blockSize: 601 } }), 1.5);
    expect(box.logical).toEqual({ w: 801, h: 601 });
    expect(box.physical).toEqual({ w: 1202, h: 902 });
  });

  test("an entry with only a device box derives the CSS one", () => {
    expect(
      boxFromEntry(entry({ device: { inlineSize: 1200, blockSize: 900 } }), 2).logical,
    ).toEqual({
      w: 600,
      h: 450,
    });
  });

  test("a nonsense ratio falls back to 1, and a zero box never reaches 0", () => {
    const box = boxFromEntry(entry({ content: { inlineSize: 100, blockSize: 50 } }), Number.NaN);
    expect(box.physical).toEqual({ w: 100, h: 50 });
    expect(boxFromEntry(entry({ content: { inlineSize: 0, blockSize: 0 } }), 2)).toEqual({
      logical: { w: 0, h: 0 },
      physical: { w: 1, h: 1 },
    });
  });
});

describe("boxFromRect", () => {
  test("reads a plain rect in both units, rounding the device box only", () => {
    const box = boxFromRect(element(800.4, 600.6), 2);
    // Logical stays fractional — the camera math wants the real number — while a
    // backing store cannot be.
    expect(box.logical).toEqual({ w: 800.4, h: 600.6 });
    expect(box.physical).toEqual({ w: 1601, h: 1201 });
  });

  test("a collapsed element reports a real empty box and a usable backing store", () => {
    const box = boxFromRect(element(0, 0), 2);
    // The truth, unclamped: a collapsed element *is* zero across.
    expect(box.logical).toEqual({ w: 0, h: 0 });
    expect(box.physical).toEqual({ w: 1, h: 1 });
  });
});
