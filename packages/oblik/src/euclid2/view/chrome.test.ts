import { afterEach, describe, expect, test, vi } from "vitest";

import { CONSTRUCTION_STROKE_PX, DEFAULT_CHROME_METRICS, chromeLayers, circleClipD, layerStrokeWidth, outsideClipD } from "./chrome";

const M = DEFAULT_CHROME_METRICS;

describe("chromeLayers", () => {
  test("base pass is paint only when idle", () => {
    expect(chromeLayers(2.8, { selected: false, hover: false, overlay: false, knockout: true }, M)).toEqual([
      { kind: "paint", width: 2.8 },
    ]);
  });

  test("base pass knockouts then paints hot or selected nodes in place", () => {
    expect(chromeLayers(2.8, { selected: true, hover: false, overlay: false, knockout: true }, M)).toEqual([
      { kind: "knockout", width: M.knockoutPx },
      { kind: "paint", width: 2.8 },
    ]);
    expect(chromeLayers(1, { selected: false, hover: true, overlay: false, knockout: true }, M)).toEqual([
      { kind: "knockout", width: M.knockoutPx },
      { kind: "paint", width: 1 },
    ]);
  });

  test("selected overlay is outline only", () => {
    expect(chromeLayers(2.8, { selected: true, hover: false, overlay: true, knockout: true }, M)).toEqual([
      { kind: "outline", width: 2.8, opacity: M.selectOutlineOpacity },
    ]);
  });

  test("hover overlay uses hover outline opacity", () => {
    expect(chromeLayers(1, { selected: false, hover: true, overlay: true, knockout: true }, M)).toEqual([
      { kind: "outline", width: 1, opacity: M.hoverOutlineOpacity },
    ]);
  });

  test("world base knockout scales by device pixel ratio", () => {
    vi.stubGlobal("window", { devicePixelRatio: 2 });
    expect(chromeLayers(1, { selected: true, hover: false, overlay: false, knockout: true }, M)).toEqual([
      { kind: "knockout", width: M.knockoutPx * 2 },
      { kind: "paint", width: 1 },
    ]);
  });

  test("screen-space knockout does not scale by dpr", () => {
    vi.stubGlobal("window", { devicePixelRatio: 2 });
    expect(
      chromeLayers(1, { selected: true, hover: false, overlay: false, knockout: true, screenSpace: true }, M),
    ).toEqual([
      { kind: "knockout", width: M.knockoutPx },
      { kind: "paint", width: 1 },
    ]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("dragging skips knockout in base pass and skips overlay", () => {
    expect(chromeLayers(CONSTRUCTION_STROKE_PX, { selected: true, hover: false, overlay: false, knockout: false }, M)).toEqual([
      { kind: "paint", width: CONSTRUCTION_STROKE_PX },
    ]);
    expect(chromeLayers(CONSTRUCTION_STROKE_PX, { selected: true, hover: false, overlay: true, knockout: false }, M)).toEqual([]);
  });

  test("idle overlay draws nothing", () => {
    expect(chromeLayers(1.35, { selected: false, hover: false, overlay: true, knockout: true }, M)).toEqual([]);
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

describe("layerStrokeWidth", () => {
  test("uses CSS logical px", () => {
    expect(layerStrokeWidth({ kind: "outline", width: 5.5 })).toBe("5.5px");
  });
});
