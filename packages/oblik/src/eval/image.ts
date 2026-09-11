import type { Aabb, Vec2 } from "../geom";

/**
 * A raster reference traced on the paper. A parallel `TraceValue` arm, like
 * `PaintValue`: **not** a `Geom` and **not** a `CsgOperand`, so nothing composes
 * it and it never enters a CSG tree. Eval therefore never learns the bitmap's
 * pixel dimensions — the world rect is explicit, and the import flow is what
 * preserves the file's aspect ratio.
 *
 * `x`/`y` is the **pre-rotation** corner: the rect is `[x, x+w] × [y, y+h]` in
 * world units, and `rot` turns that rect about its own centre. On screen (where
 * y runs down) `(x, y)` reads as the top-left corner, and a positive `rot` reads
 * as a clockwise turn. `flip` mirrors the sampled image about the vertical
 * centre axis — it changes which way the picture faces, never the rect's
 * geometry. `fade ∈ [0, 1]` mixes the image toward the paper colour, which is
 * what lets sketch lines read on top of a photograph.
 *
 * Loading and decoding stay outside this module: an `ImageValue` is a rect and a
 * URL, which is what keeps eval, pick and the GPU pure and device-free.
 */
export type ImageValue = {
  kind: "image";
  src: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rot: ImageRot;
  flip: 0 | 1;
  fade: number;
};

/** Quarter turns. Not a free angle: the steps keep the rect axis-aligned at 0/180. */
export type ImageRot = 0 | 90 | 180 | 270;

export function isImage(value: unknown): value is ImageValue {
  return !!value && typeof value === "object" && (value as ImageValue).kind === "image";
}

/**
 * Drawable/pickable: a URL, a positive rect, and numbers everywhere else.
 * A malformed image is recorded on the tape like any other non-finite value
 * (it stays in the trace, and every pick/geom path skips it) rather than being
 * silently coerced — the same contract as a NaN circle.
 */
export function isFiniteImage(value: ImageValue): boolean {
  return (
    typeof value.src === "string" &&
    value.src.length > 0 &&
    Number.isFinite(value.x) &&
    Number.isFinite(value.y) &&
    Number.isFinite(value.w) &&
    Number.isFinite(value.h) &&
    value.w > 0 &&
    value.h > 0 &&
    Number.isFinite(value.rot) &&
    Number.isFinite(value.flip) &&
    Number.isFinite(value.fade)
  );
}

/** Nearest quarter turn to `deg`, as a value the union allows. Garbage reads as 0. */
export function snapImageRot(deg: number): ImageRot {
  if (!Number.isFinite(deg)) return 0;
  const turns = ((Math.round(deg / 90) % 4) + 4) % 4;
  return (turns * 90) as ImageRot;
}

// Exact quarter-turn rotation. `Math.cos(π/2)` is 6.1e-17, and the pick geometry
// has to agree with the quad the GPU draws, so the four rotations are a table
// rather than trigonometry.
const ROT_COS = [1, 0, -1, 0];
const ROT_SIN = [0, 1, 0, -1];

function quarterTurns(rot: number): number {
  return Math.round(rot / 90) & 3;
}

/**
 * The rect's four corners in world space, starting at `(x, y)` and walking
 * `(x+w, y)`, `(x+w, y+h)`, `(x, y+h)` — the rect's own frame, rotated about the
 * centre by `rot`. On screen that order reads top-left, top-right, bottom-right,
 * bottom-left.
 */
export function imageCorners(value: ImageValue): [Vec2, Vec2, Vec2, Vec2] {
  const cx = value.x + value.w / 2;
  const cy = value.y + value.h / 2;
  const k = quarterTurns(value.rot);
  const cos = ROT_COS[k]!;
  const sin = ROT_SIN[k]!;
  const hw = value.w / 2;
  const hh = value.h / 2;
  const at = (dx: number, dy: number): Vec2 => ({
    x: cx + dx * cos - dy * sin,
    y: cy + dx * sin + dy * cos,
  });
  return [at(-hw, -hh), at(hw, -hh), at(hw, hh), at(-hw, hh)];
}

export type ImageQuadCorner = { at: Vec2; u: number; v: number };

/**
 * The textured quad: the four corners with the UV each samples. `flip` swaps
 * `u`, so the geometry is identical either way and only the picture turns over.
 * The GPU layer draws exactly this, and pickup tests sample the same corners.
 */
export function imageQuad(value: ImageValue): ImageQuadCorner[] {
  const [a, b, c, d] = imageCorners(value);
  const u0 = value.flip ? 1 : 0;
  const u1 = value.flip ? 0 : 1;
  return [
    { at: a, u: u0, v: 0 },
    { at: b, u: u1, v: 0 },
    { at: c, u: u1, v: 1 },
    { at: d, u: u0, v: 1 },
  ];
}

/** World bounds of the rotated rect, or `undefined` when the rect is not finite. */
export function imageAabb(value: ImageValue): Aabb | undefined {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of imageCorners(value)) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return undefined;
  return { minX, minY, maxX, maxY };
}

/**
 * Distance from `world` to the rotated rect, 0 inside — the same shape as
 * `distToRegion`, so an image picks like the filled thing it is.
 */
export function distToImage(value: ImageValue, world: Vec2): number {
  const cx = value.x + value.w / 2;
  const cy = value.y + value.h / 2;
  const k = quarterTurns(value.rot);
  const cos = ROT_COS[k]!;
  const sin = ROT_SIN[k]!;
  const dx = world.x - cx;
  const dy = world.y - cy;
  // World → the rect's own frame: the inverse of the rotation `imageCorners` applies.
  const lx = dx * cos + dy * sin;
  const ly = -dx * sin + dy * cos;
  const ox = Math.abs(lx) - value.w / 2;
  const oy = Math.abs(ly) - value.h / 2;
  if (ox <= 0 && oy <= 0) return 0;
  const gx = ox > 0 ? ox : 0;
  const gy = oy > 0 ? oy : 0;
  return Math.sqrt(gx * gx + gy * gy);
}

/** Advance `rot` by whole quarter turns. `x`/`y` stay the pre-rotation corner. */
export function rotateImage(value: ImageValue, steps: number): ImageValue {
  return { ...value, rot: snapImageRot(value.rot + (Number.isFinite(steps) ? steps : 0) * 90) };
}

/** Mirror the picture about the vertical centre axis. */
export function flipImage(value: ImageValue): ImageValue {
  return { ...value, flip: value.flip ? 0 : 1 };
}

/**
 * Scale about `anchor` by `k`. Uniform, so it commutes with `rot`: scaling the
 * pre-rotation rect about `anchor` is the same picture as scaling the visible
 * quad about it. This is what measure mode commits.
 */
export function scaleImage(value: ImageValue, anchor: Vec2, k: number): ImageValue {
  return {
    ...value,
    x: anchor.x + (value.x - anchor.x) * k,
    y: anchor.y + (value.y - anchor.y) * k,
    w: value.w * k,
    h: value.h * k,
  };
}
