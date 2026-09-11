import { describe, expect, test } from "vitest";

import type { Vec2 } from "../geom";
import {
  distToImage,
  flipImage,
  IMAGE_QUAD_UVS,
  imageAabb,
  imageCorners,
  imageQuad,
  isFiniteImage,
  rotateImage,
  scaleImage,
  snapImageRot,
  type ImageRot,
  type ImageValue,
} from "./image";

const base: ImageValue = {
  kind: "image",
  src: "/assets/gear-9f3a2c11.png",
  x: 10,
  y: 20,
  w: 40,
  h: 20,
  rot: 0,
  flip: 0,
  fade: 0.5,
};

/** A copy of the fixture: keeps inline props checked against the union fields. */
function img(props: Partial<ImageValue> = {}): ImageValue {
  return { ...base, ...props };
}

function byXThenY(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return a.x - b.x || a.y - b.y;
}

function span(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Twice the signed area of a triangle — its sign is the winding. */
function area2(a: Vec2, b: Vec2, c: Vec2): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

/** The visible centre is rotation-invariant. */
function centre(v: ImageValue): { x: number; y: number } {
  const box = imageAabb(v)!;
  return { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
}

describe("isFiniteImage", () => {
  test("a sized rect with a source is drawable", () => {
    expect(isFiniteImage(base)).toBe(true);
  });

  test("an empty source or a non-positive side is not", () => {
    expect(isFiniteImage(img({ src: "" }))).toBe(false);
    expect(isFiniteImage(img({ w: 0 }))).toBe(false);
    expect(isFiniteImage(img({ h: -3 }))).toBe(false);
  });

  test("NaN anywhere is not", () => {
    expect(isFiniteImage(img({ x: Number.NaN }))).toBe(false);
    // The constructor snaps `rot` to a quarter turn, so only a hand-built value
    // can carry a NaN here — which is exactly what the guard is for.
    expect(isFiniteImage(img({ rot: Number.NaN as ImageRot }))).toBe(false);
  });
});

describe("imageCorners", () => {
  test("walks the rect's own frame from (x, y)", () => {
    expect(imageCorners(base)).toEqual([
      { x: 10, y: 20 },
      { x: 50, y: 20 },
      { x: 50, y: 40 },
      { x: 10, y: 40 },
    ]);
  });

  test("rot 90 turns the rect about its centre, swapping the world extents", () => {
    // Centre (30, 30); a world-CCW quarter turn, which reads clockwise on screen.
    expect(imageCorners(img({ rot: 90 }))).toEqual([
      { x: 40, y: 10 },
      { x: 40, y: 50 },
      { x: 20, y: 50 },
      { x: 20, y: 10 },
    ]);
  });

  test("rot 180 mirrors through the centre", () => {
    expect(imageCorners(img({ rot: 180 }))).toEqual([
      { x: 50, y: 40 },
      { x: 10, y: 40 },
      { x: 10, y: 20 },
      { x: 50, y: 20 },
    ]);
  });

  test("rot 270 and a negative quarter turn agree", () => {
    expect(imageCorners(img({ rot: 270 }))).toEqual(imageCorners(rotateImage(base, -1)));
  });

  test("flip moves the picture, never the rect", () => {
    expect(imageCorners(img({ flip: 1 }))).toEqual(imageCorners(base));
  });
});

describe("imageQuad", () => {
  test("returns the rect's corners in strip order, not the perimeter walk", () => {
    // The zig-zag is what puts the shared strip edge on the diagonal: the two
    // top corners come last, so vertices 1 and 2 are opposite.
    expect(imageQuad(base)).toEqual([
      { x: 10, y: 20 },
      { x: 50, y: 20 },
      { x: 10, y: 40 },
      { x: 50, y: 40 },
    ]);
    expect(imageCorners(base)).not.toEqual(imageQuad(base));
  });

  test("flip reorders the corners, never the rect", () => {
    const quad = imageQuad(img({ flip: 1 }));
    // The left/right pairs swap: the picture is mirrored in place.
    expect(quad[0]).toEqual(imageCorners(base)[1]);
    expect(quad[1]).toEqual(imageCorners(base)[0]);
    // The two top corners keep their places; only left and right swap.
    expect(quad[2]).toEqual(imageCorners(base)[2]);
    expect(quad[3]).toEqual(imageCorners(base)[3]);
    expect([...quad].toSorted(byXThenY)).toEqual([...imageCorners(base)].toSorted(byXThenY));
  });

  /**
   * The invariant that actually makes a strip tile a rect: its two triangles are
   * `{v0,v1,v2}` and `{v1,v2,v3}`, so they share the edge `v1–v2`, and that edge
   * must be a **diagonal**. Walk the perimeter instead — which is what this code
   * first did — and the shared edge is a side: the triangles then overlap on one
   * side of it and leave a wedge of the rect uncovered, which shows up on screen
   * as a picture stretched across a quadrilateral with a triangular bite taken
   * out of it. Checking that consecutive vertices are *adjacent corners* is not
   * enough: the perimeter walk satisfies that and is still wrong.
   */
  test("every rotation and flip puts the shared strip edge on a diagonal", () => {
    for (const rot of [0, 90, 180, 270] as const) {
      for (const flip of [0, 1] as const) {
        const value = img({ rot, flip });
        const quad = imageQuad(value);
        // The shared edge is the diagonal...
        expect(span(quad[1]!, quad[2]!)).toBeCloseTo(Math.hypot(value.w, value.h), 9);
        // ...and the strip's outer edges are the rect's sides.
        for (const d of [span(quad[0]!, quad[1]!), span(quad[2]!, quad[3]!)]) {
          expect([value.w, value.h]).toContainEqual(Math.round(d * 1e9) / 1e9);
        }
      }
    }
  });

  /**
   * The invariant stated the way the rasterizer enforces it: the strip's two
   * triangles must cover the rect **exactly once**. Sampling interior points and
   * counting how many triangles contain each one catches both failure modes at
   * once — a point in no triangle (the wedge a perimeter walk leaves) and a point
   * in two (the overlap that causes it).
   */
  test("the two strip triangles tile the rect exactly once", () => {
    const inTriangle = (a: Vec2, b: Vec2, c: Vec2, p: Vec2) => {
      const d1 = area2(a, b, p);
      const d2 = area2(b, c, p);
      const d3 = area2(c, a, p);
      return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0)) ? 1 : 0;
    };
    const n = 8;
    for (const rot of [0, 90, 180, 270] as const) {
      for (const flip of [0, 1] as const) {
        const value = img({ rot, flip });
        const quad = imageQuad(value);
        const triangleArea = (p: Vec2, q: Vec2, r: Vec2) => Math.abs(area2(p, q, r)) / 2;
        // No overlap: two triangles that tile the rect have exactly its area
        // between them, so anything more means they cover the same ground twice.
        expect(
          triangleArea(quad[0]!, quad[1]!, quad[2]!) + triangleArea(quad[1]!, quad[2]!, quad[3]!),
        ).toBeCloseTo(value.w * value.h, 9);
        // Interior samples of the rect, built from its own two sides so the
        // rotation and mirror are the model's business, not the test's.
        const [a, b, , d] = imageCorners(value);
        for (let i = 1; i < n; i++) {
          for (let j = 1; j < n; j++) {
            const s = i / n;
            const t = j / n;
            const p = {
              x: a.x + s * (b.x - a.x) + t * (d.x - a.x),
              y: a.y + s * (b.y - a.y) + t * (d.y - a.y),
            };
            const covered =
              inTriangle(quad[0]!, quad[1]!, quad[2]!, p) +
              inTriangle(quad[1]!, quad[2]!, quad[3]!, p);
            // No gaps. (Points exactly on the shared edge count twice, which is
            // why the overlap half of this is the area sum below, not a count.)
            expect(covered).toBeGreaterThanOrEqual(1);
          }
        }
      }
    }
  });

  /**
   * The uv table is the corners' *screen* roles, and getting it wrong turns the
   * picture upside down without failing anything: vertex 0 is the rect's screen
   * bottom-left (world `(x, y)`, since world y runs up), so it samples the
   * texture's bottom-left, and the texture's own top-left `(0, 0)` — the way
   * WebGPU numbers them — belongs to the corner at `(x, y+h)`.
   */
  test("the uv table puts the picture's top-left at the rect's screen top-left", () => {
    expect(IMAGE_QUAD_UVS).toEqual([
      [0, 1],
      [1, 1],
      [0, 0],
      [1, 0],
    ]);
    const quad = imageQuad(base);
    const uvOf = (u: number, v: number) =>
      quad[IMAGE_QUAD_UVS.findIndex(([cu, cv]) => cu === u && cv === v)];
    // World y runs up, so the picture's top-left is the rect's (x, y+h) corner,
    // and the texture's (0, 0) is what has to land there.
    expect(uvOf(0, 0)).toEqual({ x: base.x, y: base.y + base.h });
    expect(uvOf(0, 1)).toEqual({ x: base.x, y: base.y });
    expect(uvOf(1, 0)).toEqual({ x: base.x + base.w, y: base.y + base.h });
  });
});

describe("imageAabb", () => {
  test("the unrotated box is the rect", () => {
    expect(imageAabb(base)).toEqual({ minX: 10, minY: 20, maxX: 50, maxY: 40 });
  });

  test("a quarter turn swaps width and height about the same centre", () => {
    expect(imageAabb(img({ rot: 90 }))).toEqual({ minX: 20, minY: 10, maxX: 40, maxY: 50 });
  });

  test("a non-finite rect has no box", () => {
    expect(imageAabb(img({ x: Number.NaN }))).toBeUndefined();
  });
});

describe("distToImage", () => {
  test("inside is 0, including on the edge", () => {
    expect(distToImage(base, { x: 30, y: 30 })).toBe(0);
    expect(distToImage(base, { x: 50, y: 40 })).toBe(0);
  });

  test("outside is the distance to the nearest edge or corner", () => {
    expect(distToImage(base, { x: 55, y: 30 })).toBe(5);
    expect(distToImage(base, { x: 55, y: 45 })).toBeCloseTo(Math.sqrt(50), 12);
  });

  test("a rotated rect refuses points in its old box", () => {
    const turned = img({ rot: 90 });
    // (15, 30) is inside the unrotated rect and outside the turned one.
    expect(distToImage(base, { x: 15, y: 30 })).toBe(0);
    expect(distToImage(turned, { x: 15, y: 30 })).toBe(5);
    expect(distToImage(turned, { x: 30, y: 30 })).toBe(0);
  });
});

describe("snapImageRot", () => {
  test("keeps the quarter turns and wraps the rest", () => {
    expect([0, 90, 180, 270].map(snapImageRot)).toEqual([0, 90, 180, 270]);
    expect(snapImageRot(360)).toBe(0);
    expect(snapImageRot(-90)).toBe(270);
    expect(snapImageRot(450)).toBe(90);
  });

  test("nearest turn for in-between degrees, 0 for garbage", () => {
    expect(snapImageRot(100)).toBe(90);
    expect(snapImageRot(Number.NaN)).toBe(0);
    expect(snapImageRot(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("rotateImage / flipImage", () => {
  test("four quarter turns come home", () => {
    const once = rotateImage(base, 1);
    expect(once.rot).toBe(90);
    expect(rotateImage(once, 3).rot).toBe(0);
    expect(rotateImage(base, 5).rot).toBe(90);
  });

  test("rotating keeps the visible centre", () => {
    expect(centre(rotateImage(base, 1))).toEqual(centre(base));
  });

  test("flip toggles", () => {
    expect(flipImage(base).flip).toBe(1);
    expect(flipImage(flipImage(base)).flip).toBe(0);
  });
});

describe("scaleImage", () => {
  test("scales the rect about the anchor", () => {
    const scaled = scaleImage(base, { x: 50, y: 40 }, 2);
    expect(scaled).toMatchObject({ x: -30, y: 0, w: 80, h: 40 });
  });

  test("the anchor corner does not move", () => {
    const anchor = { x: 50, y: 40 };
    const scaled = scaleImage(base, anchor, 2.5);
    // Corner 2 is the (x+w, y+h) corner, which is where the anchor sits.
    expect(imageCorners(scaled)[2]).toEqual(anchor);
  });

  test("a quarter turn in either order is the same picture", () => {
    const scaledThenTurned = rotateImage(scaleImage(base, { x: 50, y: 40 }, 2), 1);
    const turnedThenScaled = scaleImage(rotateImage(base, 1), { x: 50, y: 40 }, 2);
    const a = imageCorners(scaledThenTurned);
    const b = imageCorners(turnedThenScaled);
    for (let i = 0; i < 4; i++) {
      expect(a[i]!.x).toBeCloseTo(b[i]!.x, 9);
      expect(a[i]!.y).toBeCloseTo(b[i]!.y, 9);
    }
  });
});
