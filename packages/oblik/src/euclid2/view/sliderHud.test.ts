import { describe, expect, test } from "vitest";

import type { TraceNode } from "@/eval/context";

import { hitSlider, layoutSliders, sliderValueFromPointer } from "./sliderHud";

const SLIDER = {
  id: "o_sl",
  occ: 0,
  kind: "slider",
  value: { kind: "slider", n: 1.8, min: 0, max: 4, step: 0.05 },
  bind: "reach",
  editable: true,
  stack: [],
} as TraceNode;

describe("layoutSliders", () => {
  test("stacks panels from the top-left", () => {
    const [L] = layoutSliders([SLIDER]);
    expect(L?.panel).toEqual({ x: 12, y: 12, w: 200, h: 56 });
    expect(L?.knobX).toBeCloseTo(12 + 14 + (1.8 / 4) * (200 - 28));
  });
});

describe("hitSlider", () => {
  test("hits inside the panel", () => {
    expect(hitSlider({ x: 20, y: 20 }, [SLIDER])?.id).toBe("o_sl");
    expect(hitSlider({ x: 400, y: 400 }, [SLIDER])).toBeNull();
  });
});

describe("sliderValueFromPointer", () => {
  test("maps pointer x across the track", () => {
    const L = layoutSliders([SLIDER])[0]!;
    const mid = sliderValueFromPointer(SLIDER, L.track.x + L.track.w / 2, [SLIDER]);
    expect(mid).toBeCloseTo(2);
  });
});
