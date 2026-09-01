import { describe, expect, test } from "vitest";

import { CONSTRUCTION_STROKE_PX, FIGURE_HOVER_PX, FIGURE_PAPER_PX, FIGURE_SELECT_PX, chromeLayers } from "./chrome";

describe("chromeLayers", () => {
  test("base pass is paint only", () => {
    expect(chromeLayers(2.8, { selected: true, hover: true, overlay: false, knockout: true })).toEqual([
      { kind: "paint", width: 2.8 },
    ]);
  });

  test("selected overlay is outline, paper gap, paint", () => {
    const gap = 2.8 + 2 * FIGURE_PAPER_PX;
    expect(chromeLayers(2.8, { selected: true, hover: false, overlay: true, knockout: true })).toEqual([
      { kind: "outline", width: gap + 2 * FIGURE_SELECT_PX },
      { kind: "knockout", width: gap },
      { kind: "paint", width: 2.8 },
    ]);
  });

  test("hover overlay also knockouts, with a thinner ring", () => {
    const gap = 1 + 2 * FIGURE_PAPER_PX;
    expect(chromeLayers(1, { selected: false, hover: true, overlay: true, knockout: true })).toEqual([
      { kind: "outline", width: gap + 2 * FIGURE_HOVER_PX },
      { kind: "knockout", width: gap },
      { kind: "paint", width: 1 },
    ]);
  });

  test("dragging skips overlay chrome", () => {
    expect(chromeLayers(CONSTRUCTION_STROKE_PX, { selected: true, hover: false, overlay: true, knockout: false })).toEqual([]);
  });

  test("idle overlay draws nothing", () => {
    expect(chromeLayers(1.35, { selected: false, hover: false, overlay: true, knockout: true })).toEqual([]);
  });
});
