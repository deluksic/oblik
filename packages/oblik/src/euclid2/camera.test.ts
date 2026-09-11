import { describe, expect, test } from "vitest";

import {
  clientToNdc,
  fitWorldWidth,
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
    const rect = { left: 0, top: 0, width: 800, height: 600 };
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

  test("a pixel mouse tick is one notch", () => {
    expect(wheelZoomFactor(-100, 0)).toBeCloseTo(ZOOM_NOTCH, 10);
    expect(wheelZoomFactor(100, 0)).toBeCloseTo(1 / ZOOM_NOTCH, 10);
  });

  test("a line-mode mouse tick is one notch", () => {
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

describe("fitWorldWidth", () => {
  const view = { w: 800, h: 600, scale: 60 };
  const image = { width: 404, height: 500 };

  test("the result fits inside the view, margin included", () => {
    const width = fitWorldWidth(view, image);
    const worldW = view.w / view.scale;
    const worldH = view.h / view.scale;
    expect(width).toBeLessThan(worldW);
    expect((width * image.height) / image.width).toBeLessThan(worldH);
    // The margin is the pad on each side of the limiting axis.
    expect((width * image.height) / image.width / worldH).toBeCloseTo(0.9, 9);
  });

  test("the limiting axis decides, either way round", () => {
    const wide = { width: 4000, height: 100 };
    expect((fitWorldWidth(view, wide) * wide.height) / wide.width).toBeLessThan(
      view.h / view.scale,
    );
    const tall = { width: 100, height: 4000 };
    expect((fitWorldWidth(view, tall) * tall.height) / tall.width).toBeCloseTo(
      (view.h / view.scale) * 0.9,
      9,
    );
  });

  test("a bigger zoom fits more image, not the same", () => {
    const near = fitWorldWidth({ ...view, scale: 120 }, image);
    const far = fitWorldWidth({ ...view, scale: 60 }, image);
    expect(near).toBeCloseTo(far / 2, 9);
  });

  test("a zero-sized image or a zero zoom does not produce infinity", () => {
    expect(Number.isFinite(fitWorldWidth(view, { width: 0, height: 0 }))).toBe(true);
    expect(Number.isFinite(fitWorldWidth({ ...view, scale: 0 }, image))).toBe(true);
  });
});
