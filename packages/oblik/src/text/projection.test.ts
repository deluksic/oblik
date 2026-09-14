import { describe, expect, test } from "vitest";

import { worldToScreen } from "../euclid2/camera";
import { cameraProjection, screenOffsetToWorld } from "./layer";
import {
  identity,
  isBehind,
  lookAt,
  multiply,
  orthoPixels,
  perspective,
  pixelTransform,
  project,
  toNdc,
  type Clip4,
  type Mat4,
} from "./projection";

const { abs } = Math;
const near = (a: number, b: number, eps = 1e-9): boolean => abs(a - b) < eps;
const nearClip = (a: Clip4, b: Clip4, eps = 1e-9): boolean =>
  near(a.x, b.x, eps) && near(a.y, b.y, eps) && near(a.z, b.z, eps) && near(a.w, b.w, eps);

describe("matrix basics", () => {
  test("identity projects a point unchanged", () => {
    const c = project(identity(), { x: 3, y: 4, z: 5 });
    expect(nearClip(c, { x: 3, y: 4, z: 5, w: 1 })).toBe(true);
  });

  test("multiply applies the right matrix first", () => {
    // translate(2,0) * scale(3) should scale then translate.
    const scale = [3, 0, 0, 0, 0, 3, 0, 0, 0, 0, 3, 0, 0, 0, 0, 1] as unknown as Mat4;
    const translate = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 2, 0, 0, 1] as unknown as Mat4;
    const c = project(multiply(translate, scale), { x: 1, y: 0, z: 0 });
    expect(near(c.x, 5)).toBe(true);
  });

  test("multiply is associative on known matrices", () => {
    const a = perspective(0.8, 1.5, 0.1, 100);
    const b = lookAt({ x: 2, y: 3, z: 4 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
    const i = identity();
    const left = multiply(multiply(a, b), i);
    const right = multiply(a, multiply(b, i));
    for (let k = 0; k < 16; k += 1) expect(near(left[k]!, right[k]!)).toBe(true);
  });
});

describe("orthoPixels", () => {
  const w = 800;
  const h = 600;

  test("the top-left corner maps to NDC (-1, 1)", () => {
    const ndc = toNdc(project(orthoPixels(w, h), { x: 0, y: 0 }))!;
    expect(near(ndc.x, -1)).toBe(true);
    expect(near(ndc.y, 1)).toBe(true);
  });

  test("the bottom-right corner maps to NDC (1, -1)", () => {
    const ndc = toNdc(project(orthoPixels(w, h), { x: w, y: h }))!;
    expect(near(ndc.x, 1)).toBe(true);
    expect(near(ndc.y, -1)).toBe(true);
  });

  test("it is affine, so w stays 1 everywhere", () => {
    expect(project(orthoPixels(w, h), { x: 400, y: 300 }).w).toBe(1);
  });

  test("a degenerate pane never divides by zero", () => {
    const m = orthoPixels(0, 0);
    expect(m.every((n) => Number.isFinite(n))).toBe(true);
  });
});

describe("pixelTransform", () => {
  /**
   * The invariant the whole text path rests on. Glyph evaluates its transform
   * once per vertex at `anchor + (localX, localY)`, so a single matrix can only
   * be right if it reproduces the projection at every pixel offset — not merely
   * at the anchor. This is that check, over both an affine and a projective
   * matrix.
   */
  function reproduces(
    m: Mat4,
    anchor: { x: number; y: number; z?: number },
    offsets: [number, number][],
  ): void {
    const t = pixelTransform(m, anchor);
    for (const [dx, dy] of offsets) {
      // A positive local dy is *down* the screen, i.e. −dy in world y.
      const want = project(m, { x: anchor.x + dx, y: anchor.y - dy, z: anchor.z ?? 0 });
      // Local offsets add directly: glyph's shader does the y flip itself.
      const got: Clip4 = {
        x: t.origin.x + dx * t.ex.x + dy * t.ey.x,
        y: t.origin.y + dx * t.ex.y + dy * t.ey.y,
        z: t.origin.z + dx * t.ex.z + dy * t.ey.z,
        w: t.origin.w + dx * t.ex.w + dy * t.ey.w,
      };
      expect(nearClip(got, want, 1e-9)).toBe(true);
    }
  }

  test("the origin is the anchor's own projection", () => {
    const m = orthoPixels(800, 600);
    const t = pixelTransform(m, { x: 10, y: 20 });
    expect(nearClip(t.origin, project(m, { x: 10, y: 20 }))).toBe(true);
  });

  // oxlint-disable-next-line vitest/expect-expect -- asserts through `reproduces`
  test("an orthographic matrix reproduces every offset exactly", () => {
    reproduces(orthoPixels(800, 600), { x: 120, y: 40 }, [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
      [200, 60],
      [-50, 90],
    ]);
  });

  // oxlint-disable-next-line vitest/expect-expect -- asserts through `reproduces`
  test("a perspective matrix reproduces every offset exactly", () => {
    // Exact because the projection is linear in the plane at constant z, and the
    // shader carries z through — only the in-plane pixel steps need to agree.
    const view = lookAt({ x: 0, y: 0, z: 6 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
    const m = multiply(perspective(0.9, 1.6, 0.1, 100), view);
    reproduces(m, { x: 1, y: 0.5, z: 0 }, [
      [0, 0],
      [1, 0],
      [0, 1],
      [3, 2],
      [-1, -1],
    ]);
  });

  test("an orthographic step has no w component", () => {
    // w is constant under an orthographic projection, so both basis vectors are
    // pure directions — which is why a 2D label never needs the divide.
    const t = pixelTransform(orthoPixels(100, 100), { x: 50, y: 50 });
    expect(t.ex.w).toBe(0);
    expect(t.ey.w).toBe(0);
    expect(t.ex.x).toBeGreaterThan(0);
  });
});

describe("perspective and view", () => {
  test("the camera's target lands on the NDC axis", () => {
    const view = lookAt({ x: 0, y: 0, z: 5 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
    const m = multiply(perspective(1, 1, 0.1, 100), view);
    const c = project(m, { x: 0, y: 0, z: 0 });
    expect(near(c.x, 0)).toBe(true);
    expect(near(c.y, 0)).toBe(true);
    // A point in front of the camera has positive w; behind it, negative.
    expect(c.w).toBeGreaterThan(0);
    expect(project(m, { x: 0, y: 0, z: 20 }).w).toBeLessThan(0);
  });

  test("nearer geometry has a smaller depth", () => {
    const view = lookAt({ x: 0, y: 0, z: 5 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
    const m = multiply(perspective(1, 1, 0.1, 100), view);
    const closer = project(m, { x: 0, y: 0, z: 1 });
    const farther = project(m, { x: 0, y: 0, z: -1 });
    expect(closer.z / closer.w).toBeLessThan(farther.z / farther.w);
  });

  test("isBehind flags the half-space behind the eye", () => {
    expect(isBehind({ x: 0, y: 0, z: 0, w: 0 })).toBe(true);
    expect(isBehind({ x: 0, y: 0, z: 0, w: -2 })).toBe(true);
    expect(isBehind({ x: 0, y: 0, z: 0, w: 2 })).toBe(false);
    expect(toNdc({ x: 1, y: 1, z: 0, w: 0 })).toBeUndefined();
  });
});

describe("cameraProjection", () => {
  /**
   * The equivalence the world-anchored label path rests on.
   *
   * The pane used to convert a world anchor to screen pixels on the CPU. Now a
   * label carries a **world** anchor and the shader computes
   * `cameraProjection(cam) × (world + offset)`, and the result must land in the
   * same place — otherwise every label shifts the moment this changed, and only
   * a pan would reveal that the offset direction was wrong.
   */
  const panes = [
    { w: 800, h: 600 },
    { w: 1233, h: 481 },
  ];
  const cameras = [
    { x: 0, y: 0, scale: 48 },
    { x: -3.25, y: 7.5, scale: 48 },
    { x: 12, y: -4, scale: 137.5 },
    { x: 0, y: 0, scale: 8 },
  ];
  const anchors = [
    { x: 0, y: 0 },
    { x: 3, y: 4 },
    { x: -12.5, y: 2.25 },
  ];

  test("a world anchor plus an offset lands where worldToScreen put it", () => {
    for (const pane of panes) {
      for (const cam of cameras) {
        for (const at of anchors) {
          const m = cameraProjection(cam, { width: pane.w, height: pane.h });
          for (const [dx, dy] of [
            [0, 0],
            [10, -8],
            [10, -18],
          ]) {
            // Screen pixels -> world distance. The pane's y mapping is
            // sy = h/2 - (y-cam.y)·scale, so a *negative* screen dy (up) is a
            // positive world dy — the scale divides without changing the sign.
            const ow = screenOffsetToWorld({ x: dx, y: dy }, cam.scale);
            const clip = project(m, { x: at.x + ow.x, y: at.y - ow.y, z: 0 });
            expect(clip.w).toBe(1);
            const sx = ((clip.x / clip.w + 1) / 2) * pane.w;
            const sy = ((1 - clip.y / clip.w) / 2) * pane.h;
            // Where the old CPU path landed: worldToScreen, then the offset.
            const want = worldToScreen({ x: at.x, y: at.y }, cam, pane);
            expect(sx).toBeCloseTo(want.x + dx, 6);
            expect(sy).toBeCloseTo(want.y + dy, 6);
          }
        }
      }
    }
  });

  test("the projection is affine and carries no w", () => {
    const m = cameraProjection({ x: 1, y: 2, scale: 48 }, { width: 800, height: 600 });
    expect(project(m, { x: 0, y: 0 }).w).toBe(1);
  });
});
