import { afterEach, describe, expect, test, vi } from "vitest";

import { CONSTRUCTION_STROKE_PX, DEFAULT_CHROME_METRICS, chromeClipUrl, chromeLayers, circleClipD, layerStrokeWidth, outsideClipD } from "./chrome";

const M = DEFAULT_CHROME_METRICS;

describe("chromeLayers", () => {
  test("base pass is paint only", () => {
    expect(chromeLayers(2.8, { selected: true, hover: true, overlay: false, knockout: true }, M)).toEqual([
      { kind: "paint", width: 2.8 },
    ]);
  });

  test("selected overlay keeps a 2px ring and adds an inside knockout", () => {
    const gap = 2.8 + 2 * M.gapPx;
    expect(chromeLayers(2.8, { selected: true, hover: false, overlay: true, knockout: true }, M)).toEqual([
      { kind: "outline", width: gap + 2 * M.selectRingPx, clip: "outside" },
      { kind: "knockout", width: gap, clip: "outside" },
      { kind: "knockout", width: 2.8 + 2 * M.bleedPx, clip: "inside" },
      { kind: "paint", width: 2.8 },
    ]);
  });

  test("hover overlay also knockouts, with a thinner ring", () => {
    const gap = 1 + 2 * M.gapPx;
    expect(chromeLayers(1, { selected: false, hover: true, overlay: true, knockout: true }, M)).toEqual([
      { kind: "outline", width: gap + 2 * M.hoverRingPx, clip: "outside" },
      { kind: "knockout", width: gap, clip: "outside" },
      { kind: "knockout", width: 1 + 2 * M.bleedPx, clip: "inside" },
      { kind: "paint", width: 1 },
    ]);
  });

  test("world overlay scales gap and ring by device pixel ratio", () => {
    vi.stubGlobal("window", { devicePixelRatio: 2 });
    const gap = 1 + 2 * M.gapPx * 2;
    expect(chromeLayers(1, { selected: true, hover: false, overlay: true, knockout: true }, M)).toEqual([
      { kind: "outline", width: gap + 2 * M.selectRingPx * 2, clip: "outside" },
      { kind: "knockout", width: gap, clip: "outside" },
      { kind: "knockout", width: 1 + 2 * M.bleedPx * 2, clip: "inside" },
      { kind: "paint", width: 1 },
    ]);
  });

  test("screen-space overlay does not scale by dpr", () => {
    vi.stubGlobal("window", { devicePixelRatio: 2 });
    const gap = 1 + 2 * M.gapPx;
    expect(
      chromeLayers(1, { selected: true, hover: false, overlay: true, knockout: true, screenSpace: true }, M),
    ).toEqual([
      { kind: "outline", width: gap + 2 * M.selectRingPx, clip: "outside" },
      { kind: "knockout", width: gap, clip: "outside" },
      { kind: "knockout", width: 1 + 2 * M.bleedPx, clip: "inside" },
      { kind: "paint", width: 1 },
    ]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("filled overlay is boundary chrome only", () => {
    const gap = 1.5 + 2 * M.gapPx;
    expect(chromeLayers(1.5, { selected: true, hover: false, overlay: true, knockout: true, filled: true }, M)).toEqual([
      { kind: "outline", width: gap + 2 * M.selectRingPx, clip: "outside" },
      { kind: "knockout", width: gap, clip: "outside" },
    ]);
  });

  test("dragging skips overlay chrome", () => {
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

describe("chromeClipUrl", () => {
  test("routes outside and inside clips", () => {
    expect(chromeClipUrl("out", "in", { kind: "outline", width: 2, clip: "outside" })).toBe("url(#out)");
    expect(chromeClipUrl("out", "in", { kind: "knockout", width: 2, clip: "inside" })).toBe("url(#in)");
    expect(chromeClipUrl("out", "in", { kind: "paint", width: 2 })).toBeUndefined();
  });
});

describe("layerStrokeWidth", () => {
  test("uses CSS logical px", () => {
    expect(layerStrokeWidth({ kind: "outline", width: 5.5 })).toBe("5.5px");
  });
});
