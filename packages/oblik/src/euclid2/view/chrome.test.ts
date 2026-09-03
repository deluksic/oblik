import { afterEach, describe, expect, test, vi } from "vitest";

import {
  CONSTRUCTION_STROKE_PX,
  DEFAULT_CHROME_METRICS,
  chromeClipUrl,
  chromeLayers,
  chromeLayersEqual,
  circleClipD,
  layerStrokeWidth,
  outsideClipD,
} from "./chrome";

const M = DEFAULT_CHROME_METRICS;

describe("chromeLayers", () => {
  test("base pass is paint only when idle", () => {
    expect(chromeLayers(2.8, { selected: false, hover: false, overlay: false }, M)).toEqual([
      { kind: "paint", width: 2.8 },
    ]);
  });

  test("base pass is paint only when hovered; outline lives in the overlay", () => {
    expect(chromeLayers(1, { selected: false, hover: true, overlay: false }, M)).toEqual([
      { kind: "paint", width: 1 },
    ]);
  });

  test("selected base pass is paint only; outline and gap live in the overlay", () => {
    expect(chromeLayers(2.8, { selected: true, hover: false, overlay: false }, M)).toEqual([
      { kind: "paint", width: 2.8 },
    ]);
  });

  test("hover overlay is a translucent outline with no knockout gap", () => {
    expect(chromeLayers(1, { selected: false, hover: true, overlay: true }, M)).toEqual([
      { kind: "outline", width: M.outlinePx, opacity: M.hoverOutlineOpacity },
    ]);
  });

  test("selected overlay is an opaque outline with a thinner knockout on top", () => {
    expect(
      chromeLayers(CONSTRUCTION_STROKE_PX, { selected: true, hover: false, overlay: true }, M),
    ).toEqual([
      { kind: "outline", width: M.outlinePx, opacity: M.selectOutlineOpacity },
      { kind: "knockout", width: M.knockoutPx },
    ]);
    expect(M.knockoutPx).toBeLessThan(M.outlinePx);
    expect(M.selectOutlineOpacity).toBe(1);
  });

  test("selected knockout stays wider than thick figure paint so the gap is visible", () => {
    const layers = chromeLayers(5.6, { selected: true, hover: false, overlay: true }, M);
    const outline = layers.find((l) => l.kind === "outline");
    const knock = layers.find((l) => l.kind === "knockout");
    expect(knock?.width).toBeGreaterThan(5.6);
    expect(outline?.width).toBeGreaterThan(knock!.width);
    expect(
      chromeLayers(2.8, { selected: true, hover: false, overlay: true }, M)[1]?.width,
    ).toBeGreaterThan(2.8);
    // 5.6px paint: paper extra 2.5, ring extra 3 → knockout 8.1, outline 11.1
    expect(knock?.width).toBe(5.6 + (M.knockoutPx - CONSTRUCTION_STROKE_PX));
    expect(outline?.width).toBe(knock!.width + (M.outlinePx - M.knockoutPx));
  });

  test("world overlay outline scales by device pixel ratio", () => {
    vi.stubGlobal("window", { devicePixelRatio: 2 });
    expect(chromeLayers(1, { selected: true, hover: false, overlay: true }, M)).toEqual([
      { kind: "outline", width: M.outlinePx * 2, opacity: M.selectOutlineOpacity },
      { kind: "knockout", width: M.knockoutPx * 2 },
    ]);
  });

  test("world hover overlay outline scales by device pixel ratio", () => {
    vi.stubGlobal("window", { devicePixelRatio: 2 });
    expect(chromeLayers(1, { selected: false, hover: true, overlay: true }, M)).toEqual([
      { kind: "outline", width: M.outlinePx * 2, opacity: M.hoverOutlineOpacity },
    ]);
  });

  test("screen-space overlay does not scale knockout by dpr", () => {
    vi.stubGlobal("window", { devicePixelRatio: 2 });
    expect(
      chromeLayers(1, { selected: true, hover: false, overlay: true, screenSpace: true }, M),
    ).toEqual([
      { kind: "outline", width: M.outlinePx, opacity: M.selectOutlineOpacity },
      { kind: "knockout", width: M.knockoutPx },
    ]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("idle overlay draws nothing", () => {
    expect(chromeLayers(1.35, { selected: false, hover: false, overlay: true }, M)).toEqual([]);
  });

  test("chromeLayersEqual ignores array identity", () => {
    const a = chromeLayers(1.5, { selected: false, hover: false, overlay: false }, M);
    const b = chromeLayers(1.5, { selected: false, hover: false, overlay: false }, M);
    expect(a).not.toBe(b);
    expect(chromeLayersEqual(a, b)).toBe(true);
    expect(
      chromeLayersEqual(a, chromeLayers(1.5, { selected: false, hover: true, overlay: true }, M)),
    ).toBe(false);
  });

  test("point hover overlay uses a wider band than strokes", () => {
    expect(
      chromeLayers(2, { selected: false, hover: true, overlay: true, point: true }, M),
    ).toEqual([{ kind: "outline", width: M.pointOutlinePx, opacity: M.hoverOutlineOpacity }]);
    expect(M.pointOutlinePx).toBeGreaterThan(M.outlinePx);
  });

  test("point selected overlay uses a wider opaque ring and gap", () => {
    expect(
      chromeLayers(2, { selected: true, hover: false, overlay: true, point: true }, M),
    ).toEqual([
      { kind: "outline", width: M.pointOutlinePx, opacity: M.selectOutlineOpacity },
      { kind: "knockout", width: M.pointKnockoutPx },
    ]);
    expect(M.pointKnockoutPx).toBeLessThan(M.pointOutlinePx);
    expect(M.pointKnockoutPx).toBeGreaterThan(M.knockoutPx);
  });
});

describe("outsideClipD", () => {
  test("even-odd universe minus inner path", () => {
    expect(outsideClipD("M0,0h1v1h-1z", 10)).toBe("M-10,-10H10V10H-10ZM0,0h1v1h-1z");
  });

  test("empty inner yields empty clip", () => {
    expect(outsideClipD("")).toBe("");
  });
});

describe("circleClipD", () => {
  test("two-arc closed circle", () => {
    expect(circleClipD(0, 0, 2)).toBe("M-2,0a2,2 0 1,0 4,0a2,2 0 1,0 -4,0z");
  });

  test("skips degenerate radii", () => {
    expect(circleClipD(1, 1, 0)).toBe("");
  });
});

describe("chromeClipUrl", () => {
  test("wraps a clip id", () => {
    expect(chromeClipUrl("chrome-out-abc")).toBe("url(#chrome-out-abc)");
  });
});

describe("layerStrokeWidth", () => {
  test("uses CSS logical px", () => {
    expect(layerStrokeWidth({ kind: "outline", width: 5.5 })).toBe("5.5px");
  });
});
