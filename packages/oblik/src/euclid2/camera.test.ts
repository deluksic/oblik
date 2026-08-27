import { describe, expect, test } from "vitest";

import {
  clientToNdc,
  ndcToWorld,
  screenToWorld,
  wheelZoomFactor,
  worldToNdc,
  worldToScreen,
  zoomAt,
  ZOOM_NOTCH,
  type Camera2,
  type PaneSize,
} from "./camera";

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

  test("zoomAt keeps the world point under the cursor", () => {
    const screen = { x: 120, y: 90 };
    const world = screenToWorld(screen, cam, size);
    const next = zoomAt(cam, screen, size, 1.08);
    const after = worldToScreen(world, next, size);
    expect(after.x).toBeCloseTo(screen.x, 10);
    expect(after.y).toBeCloseTo(screen.y, 10);
    expect(next.scale).toBeCloseTo(cam.scale * 1.08, 10);
    expect(next.x).not.toBeCloseTo(cam.x, 5);
    expect(next.y).not.toBeCloseTo(cam.y, 5);
  });

  test("zoomAt at the pane center only changes scale", () => {
    const next = zoomAt(cam, { x: size.w / 2, y: size.h / 2 }, size, 1 / 1.08);
    expect(next.x).toBeCloseTo(cam.x, 10);
    expect(next.y).toBeCloseTo(cam.y, 10);
    expect(next.scale).toBeCloseTo(cam.scale / 1.08, 10);
  });

  test("a pixel mouse tick matches the old 8% step", () => {
    expect(wheelZoomFactor(-100, 0)).toBeCloseTo(ZOOM_NOTCH, 10);
    expect(wheelZoomFactor(100, 0)).toBeCloseTo(1 / ZOOM_NOTCH, 10);
  });

  test("a line-mode mouse tick matches the old 8% step", () => {
    expect(wheelZoomFactor(-1, 1)).toBeCloseTo(ZOOM_NOTCH, 10);
    expect(wheelZoomFactor(1, 1)).toBeCloseTo(1 / ZOOM_NOTCH, 10);
  });

  test("many small pixel events compose like one mouse tick", () => {
    let factor = 1;
    for (let i = 0; i < 25; i++) factor *= wheelZoomFactor(4, 0);
    expect(factor).toBeCloseTo(wheelZoomFactor(100, 0), 10);
  });

  test("a huge delta is clamped to a few notches", () => {
    expect(wheelZoomFactor(10_000, 0)).toBeCloseTo(ZOOM_NOTCH ** -4, 10);
    expect(wheelZoomFactor(-1, 2)).toBeCloseTo(ZOOM_NOTCH ** 4, 10);
  });
});
