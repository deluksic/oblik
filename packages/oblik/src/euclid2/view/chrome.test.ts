import { describe, expect, test } from "vitest";

import { CONSTRUCTION_STROKE_PX, DEFAULT_CHROME_METRICS, chromeLayers, layerStrokeWidth } from "./chrome";

const M = DEFAULT_CHROME_METRICS;

describe("chromeLayers", () => {
  test("base pass is paint only", () => {
    expect(chromeLayers(2.8, { selected: true, hover: true, overlay: false, knockout: true }, M)).toEqual([
      { kind: "paint", width: 2.8 },
    ]);
  });

  test("selected overlay is outline, paper gap, paint", () => {
    const gap = 2.8 + 2 * M.gapPx;
    expect(chromeLayers(2.8, { selected: true, hover: false, overlay: true, knockout: true }, M)).toEqual([
      { kind: "outline", width: gap + 2 * M.selectRingPx },
      { kind: "knockout", width: gap },
      { kind: "paint", width: 2.8 },
    ]);
  });

  test("hover overlay also knockouts, with a thinner ring", () => {
    const gap = 1 + 2 * M.gapPx;
    expect(chromeLayers(1, { selected: false, hover: true, overlay: true, knockout: true }, M)).toEqual([
      { kind: "outline", width: gap + 2 * M.hoverRingPx },
      { kind: "knockout", width: gap },
      { kind: "paint", width: 1 },
    ]);
  });

  test("dragging skips overlay chrome", () => {
    expect(chromeLayers(CONSTRUCTION_STROKE_PX, { selected: true, hover: false, overlay: true, knockout: false }, M)).toEqual([]);
  });

  test("idle overlay draws nothing", () => {
    expect(chromeLayers(1.35, { selected: false, hover: false, overlay: true, knockout: true }, M)).toEqual([]);
  });
});

describe("layerStrokeWidth", () => {
  test("uses CSS logical px", () => {
    expect(layerStrokeWidth({ kind: "outline", width: 5.5 })).toBe("5.5px");
  });
});
