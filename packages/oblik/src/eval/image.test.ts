import { describe, expect, test } from "vitest";

import {
  distToImage,
  flipImage,
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
  test("samples the corners in order", () => {
    expect(imageQuad(base).map((c) => [c.u, c.v])).toEqual([
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ]);
  });

  test("flip swaps u across the vertical centre axis", () => {
    expect(imageQuad(img({ flip: 1 })).map((c) => [c.u, c.v])).toEqual([
      [1, 0],
      [0, 0],
      [0, 1],
      [1, 1],
    ]);
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
