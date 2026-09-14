import { describe, expect, test } from "vitest";

import { worldToScreen } from "../euclid2/camera";
import { paneProjection, type Mat4 } from "./projection";

/**
 * `paneProjection` is the whole of the GPU label path's camera, and the one
 * property that matters is that it agrees with the HTML overlay.
 *
 * The reference is stated *here* rather than imported: `worldToScreen` is the
 * overlay's own convention, and the pixel→clip half is written out longhand in
 * the test. Checking a production helper against another production helper would
 * only prove the two are consistent — including consistently wrong.
 */

const { abs } = Math;
const near = (a: number, b: number, eps = 1e-9): boolean => abs(a - b) < eps;

/** The pane's pixel→clip convention, applied to a point already in screen px. */
function screenToClip(
  screen: { x: number; y: number },
  viewport: { width: number; height: number },
): { x: number; y: number } {
  return {
    x: (screen.x * 2) / viewport.width - 1,
    y: 1 - (screen.y * 2) / viewport.height,
  };
}

/** `m × (x, y, 0, 1)`, divided through by w. Orthographic here, so w is 1. */
function project(m: Mat4, p: { x: number; y: number }): { x: number; y: number; w: number } {
  const x = m[0] * p.x + m[4] * p.y + m[12];
  const y = m[1] * p.x + m[5] * p.y + m[13];
  return { x, y, w: m[3] * p.x + m[7] * p.y + m[15] };
}

const viewport = { width: 1024, height: 768 };
/** `worldToScreen` speaks PaneSize (`w`/`h`); the projection speaks width/height. */
const pane = { w: viewport.width, h: viewport.height };

describe("paneProjection", () => {
  const cameras = [
    { x: 0, y: 0, scale: 48 },
    { x: -12.5, y: 7.25, scale: 8 },
    { x: 300, y: -180, scale: 280 },
  ];
  const points = [
    { x: 0, y: 0 },
    { x: 3.5, y: -2.25 },
    { x: -140, y: 96 },
  ];

  test("is exactly worldToScreen followed by the pane's pixel→clip", () => {
    for (const cam of cameras) {
      const matrix = paneProjection(cam, viewport);
      for (const world of points) {
        const expected = screenToClip(worldToScreen(world, cam, pane), viewport);
        const actual = project(matrix, world);
        expect(actual.w).toBe(1);
        expect(near(actual.x, expected.x)).toBe(true);
        expect(near(actual.y, expected.y)).toBe(true);
      }
    }
  });

  test("a pan is a translation of the anchor, not a rescaled one", () => {
    // The camera must move the anchor without scaling the pixels around it: that
    // is the property the old single-matrix shader could not express, and the
    // reason a world-anchored label is possible at all.
    const a = paneProjection({ x: 0, y: 0, scale: 48 }, viewport);
    const b = paneProjection({ x: 10, y: -5, scale: 48 }, viewport);
    const one = project(a, { x: 1, y: 1 });
    const two = project(b, { x: 1, y: 1 });
    expect(near(two.x - one.x, (2 * 48 * -10) / viewport.width)).toBe(true);
    expect(near(two.y - one.y, (2 * 48 * 5) / viewport.height)).toBe(true);
  });

  test("a zoom scales the anchor", () => {
    const a = project(paneProjection({ x: 0, y: 0, scale: 48 }, viewport), { x: 1, y: 0 });
    const b = project(paneProjection({ x: 0, y: 0, scale: 96 }, viewport), { x: 1, y: 0 });
    expect(near(b.x, a.x * 2)).toBe(true);
  });

  test("the camera centre lands at the pane centre", () => {
    const cam = { x: 17, y: -9, scale: 33 };
    const at = project(paneProjection(cam, viewport), cam);
    expect(near(at.x, 0)).toBe(true);
    expect(near(at.y, 0)).toBe(true);
  });

  test("y grows upward, so north of the camera is above centre", () => {
    const cam = { x: 0, y: 0, scale: 48 };
    expect(project(paneProjection(cam, viewport), { x: 0, y: 5 }).y).toBeGreaterThan(0);
  });

  test("a degenerate viewport stays finite", () => {
    const at = project(paneProjection({ x: 0, y: 0, scale: 48 }, { width: 0, height: 0 }), {
      x: 1,
      y: 1,
    });
    expect(Number.isFinite(at.x)).toBe(true);
    expect(Number.isFinite(at.y)).toBe(true);
  });
});
