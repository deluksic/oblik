import { describe, expect, test } from "vitest";

import type { TraceNodeOf } from "#eval/context";

import {
  hitSlider,
  layoutSliders,
  sliderValueFromPointer,
  SLIDER_MARGIN,
  SLIDER_PANEL_H,
  SLIDER_PANEL_W,
} from "./sliderHud";

const SLIDER: TraceNodeOf<"slider"> = {
  id: "o_sl",
  occ: 0,
  kind: "slider",
  value: { kind: "slider", n: 1.8, min: 0, max: 4, step: 0.05 },
  bind: "reach",
  editable: true,
  stack: [],
};

describe("layoutSliders", () => {
  test("stacks panels from the top-left", () => {
    const [L] = layoutSliders([SLIDER]);
    expect(L?.panel).toEqual({
      x: SLIDER_MARGIN,
      y: SLIDER_MARGIN,
      w: SLIDER_PANEL_W,
      h: SLIDER_PANEL_H,
    });
    // The track spans the whole panel (the rail is inset from the panel's edge,
    // the title above it further still), so the knob position is just the
    // panel's left edge plus the value's fraction of the panel width.
    expect(L?.track).toEqual({
      x: SLIDER_MARGIN,
      y: SLIDER_MARGIN + 36,
      w: SLIDER_PANEL_W,
      h: 6,
    });
    expect(L?.knobX).toBeCloseTo(SLIDER_MARGIN + (1.8 / 4) * SLIDER_PANEL_W);
  });
});

describe("hitSlider", () => {
  test("hits inside the panel", () => {
    expect(hitSlider({ x: 20, y: 20 }, [SLIDER])?.id).toBe("o_sl");
    expect(hitSlider({ x: 400, y: 400 }, [SLIDER])).toBeUndefined();
  });
});

describe("sliderValueFromPointer", () => {
  test("maps pointer x across the track", () => {
    const L = layoutSliders([SLIDER])[0]!;
    const mid = sliderValueFromPointer(SLIDER, L.track.x + L.track.w / 2, [SLIDER]);
    expect(mid).toBeCloseTo(2);
  });
});
