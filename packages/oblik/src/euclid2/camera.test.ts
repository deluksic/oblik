import { describe, expect, test } from "vitest";

import { clientToNdc, ndcToWorld, worldToNdc, worldToScreen, type Camera2, type PaneSize } from "./camera";

describe("camera", () => {
  const cam: Camera2 = { x: 2.5, y: 1.2, scale: 72 };
  const size: PaneSize = { w: 800, h: 600 };

  test("world → ndc → world round-trips", () => {
    const w = { x: 5.02, y: 1.77 };
    const back = ndcToWorld(worldToNdc(w, cam, size), cam, size);
    expect(back.x).toBeCloseTo(w.x, 10);
    expect(back.y).toBeCloseTo(w.y, 10);
  });

  test("worldToScreen matches NDC mapped through the pane", () => {
    const w = { x: 5.02, y: 1.77 };
    const ndc = worldToNdc(w, cam, size);
    const screen = {
      x: (ndc.x / (2 * (size.w / size.h)) + 0.5) * size.w,
      y: ((ndc.y + 1) / 2) * size.h,
    };
    const direct = worldToScreen(w, cam, size);
    expect(direct.x).toBeCloseTo(screen.x, 10);
    expect(direct.y).toBeCloseTo(screen.y, 10);
  });

  test("client center maps to camera look-at", () => {
    const rect = { left: 0, top: 0, width: 800, height: 600 } as DOMRect;
    const ndc = clientToNdc({ x: 400, y: 300 }, rect, size);
    const w = ndcToWorld(ndc, cam, size);
    expect(w.x).toBeCloseTo(cam.x, 10);
    expect(w.y).toBeCloseTo(cam.y, 10);
  });
});
