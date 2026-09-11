import type { Aabb, Vec2 } from "../geom";

/**
 * A raster reference traced on the paper. A parallel `TraceValue` arm, like
 * `PaintValue`: **not** a `Geom` and **not** a `CsgOperand`, so nothing composes
 * it and it never enters a CSG tree. Eval therefore never learns the bitmap's
 * pixel dimensions — the world rect is explicit, and the import flow is what
 * preserves the file's aspect ratio.
 *
 * This is the *resolved* form: a concrete world rect, which is what pick and the
 * GPU need and all they see. The authoring form — an anchor, the bitmap's pixel
 * size and a target size — is `ImageOpts`, and `imageRect` is the conversion;
 * nothing downstream of here knows about pixels.
 *
 * `x`/`y` is the **pre-rotation** minimum corner, the one the rect grows `+w`
 * and `+h` from, and `rot` turns the rect about its own centre. World y runs up
 * while image y runs down, so the bitmap's top-left is the rect's `(x, y+h)`
 * corner; a positive `rot` reads as a clockwise turn on screen. `flip` mirrors
 * the sampled image about the vertical centre axis — it changes which way the
 * picture faces, never the rect's geometry. `fade ∈ [0, 1]` mixes the image
 * toward the paper colour, which is what lets sketch lines read on top of a
 * photograph.
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

/**
 * Everything about a reference but its source: where it is pinned, how big the
 * bitmap is, how big to draw it, and the three look props.
 *
 * `world` is where it goes and `anchor` is the pixel of the bitmap that goes
 * there — the **anchor point**, as After Effects and Figma call it (Flash's
 * *registration point*, Illustrator's *reference point*, a game engine's
 * *pivot*; paired with a world coordinate it is a *control point*). It defaults
 * to the bitmap's top-left, so the picture hangs down and to the right of
 * `world` — the reading every other rect in this system has (SVG, canvas, CSS).
 * Anchor the centre to place a reference by its middle, or a hole to pin the
 * reference to the feature being traced.
 *
 * A **traced point drops straight into `world`**: a `point()` is a `Vec2`, so
 * `image(src, { world: P, … })` pins the reference to it and eval reads its
 * coordinates — move the point and the picture moves with it, the same way
 * `circle(P, r)` does.
 *
 * `imageSize` — the bitmap's own pixel size — is what the aspect comes from, and
 * it is stated here rather than read from the file so that **nothing about
 * evaluation is asynchronous and nothing has to decode**: eval does arithmetic
 * on numbers the script gave it. `targetSize` states the world size; one side
 * infers the other from that aspect, both sides allow deliberate distortion.
 *
 * Image space is **pixels, y running down** from the top-left, the way the
 * bitmap and the uv table are numbered; world y runs up. `imageRect` is the one
 * place that conversion happens.
 */
export type ImageOpts = {
  world: Vec2;
  anchor?: Vec2;
  imageSize: { width: number; height: number };
  targetSize: { width?: number; height?: number };
  rot?: ImageRot;
  flip?: 0 | 1;
  fade?: number;
};

/** The world rect a reference occupies: its minimum corner, growing `+w`/`+h`. */
export type ImageRect = { x: number; y: number; w: number; h: number };

function num(value: unknown): number {
  return typeof value === "number" ? value : Number.NaN;
}

/** A rect that nothing can draw, pick or bound — the shape every bad call takes. */
function nanRect(): ImageRect {
  return { x: Number.NaN, y: Number.NaN, w: Number.NaN, h: Number.NaN };
}

/**
 * The world rect a call describes, or an all-NaN rect when the call cannot
 * describe one — no target size at all, a non-positive side, a pixel size that
 * is missing or degenerate, or a `world` that names no point. A NaN rect
 * is not a throw: `isFiniteImage` keeps the node off the tape, which is how
 * every other malformed value in this system behaves.
 *
 * Inference is per-axis scale: `targetSize.width / imageSize.width` is the scale
 * when a width is stated, and the other axis takes the same scale. When both
 * sides are stated the scales are independent, which is the deliberate
 * distortion the rect allows. The rect is then shifted so that the pixel
 * `anchor` lands exactly on `world` — with the default, the bitmap's own (0, 0)
 * sits at the rect's world *maximum* y, because image y runs down and world y
 * runs up.
 */
export function imageRect(opts: Partial<ImageOpts> | undefined): ImageRect {
  const o = opts && typeof opts === "object" ? opts : {};
  const iw = num(o.imageSize?.width);
  const ih = num(o.imageSize?.height);
  if (!(iw > 0) || !(ih > 0)) return nanRect();
  // A `point()` is a Vec2, so this reads whatever the script pinned to.
  const wx = num(o.world?.x);
  const wy = num(o.world?.y);
  if (!Number.isFinite(wx) || !Number.isFinite(wy)) return nanRect();

  const hasW = Number.isFinite(num(o.targetSize?.width));
  const hasH = Number.isFinite(num(o.targetSize?.height));
  if (!hasW && !hasH) return nanRect();
  const w = hasW ? num(o.targetSize?.width) : (num(o.targetSize?.height) / ih) * iw;
  const h = hasH ? num(o.targetSize?.height) : (num(o.targetSize?.width) / iw) * ih;
  if (!(w > 0) || !(h > 0)) return nanRect();

  const ax = Number.isFinite(num(o.anchor?.x)) ? num(o.anchor?.x) : 0;
  const ay = Number.isFinite(num(o.anchor?.y)) ? num(o.anchor?.y) : 0;
  // world = world0 + ((px - ax) · w/iw, -(py - ay) · h/ih); take the rect's corners.
  const kx = w / iw;
  const ky = h / ih;
  return {
    x: wx - ax * kx,
    y: wy - (ih - ay) * ky,
    w,
    h,
  };
}

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
 * centre by `rot`.
 *
 * On screen world y runs **up**, so that walk reads bottom-left, bottom-right,
 * top-right, top-left: the `(x, y)` corner is the rect's *screen* bottom-left,
 * and the picture's own top-left is the corner at `(x, y+h)`. `imageQuad` and
 * the shader's uv table are both written against that order.
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

/**
 * The textured quad in **strip order**.
 *
 * Not the walk `imageCorners` returns: a four-vertex triangle strip advances two
 * vertices at a time, so its two triangles are `{v0,v1,v2}` and `{v1,v2,v3}` and
 * they share the edge `v1–v2`. For those two triangles to *tile* the rect, that
 * shared edge has to be a **diagonal** — walking the perimeter instead puts the
 * shared edge on a side, so the triangles overlap on one side and leave a wedge
 * of the rect uncovered. Hence `a, b, d, c` (the zig-zag the fill and grid quads
 * use too), not `a, b, c, d`. `image.test.ts` pins the diagonal.
 *
 * `flip` is folded in here, by swapping the left/right pairs rather than the
 * texture coordinates: the four positions are unchanged, the picture turns over,
 * and the shader has no flip flag to branch on. `rot` is already baked into the
 * corners by `imageCorners`, so the GPU layer receives a quad and samples it.
 */
export function imageQuad(value: ImageValue): [Vec2, Vec2, Vec2, Vec2] {
  const [a, b, c, d] = imageCorners(value);
  return value.flip ? [b, a, c, d] : [a, b, d, c];
}

/**
 * The texture coordinate each quad vertex samples, in `imageQuad`'s order.
 *
 * These are the corners' *screen* roles, and getting them wrong turns the
 * picture upside down rather than failing loudly: vertex 0 is the rect's screen
 * bottom-left, so it samples the texture's bottom-left `(0, 1)`, and the
 * texture's `(0, 0)` — its top-left, the way WebGPU numbers them — belongs to
 * vertex 2 (the rect's screen top-left, since the strip order puts the two top
 * corners last). The shader derives the same table; `wgsl.test.ts` pins it.
 */
export const IMAGE_QUAD_UVS: readonly (readonly [number, number])[] = [
  [0, 1],
  [1, 1],
  [0, 0],
  [1, 0],
];

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
