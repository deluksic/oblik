import type { Aabb, Vec2 } from "../geom";

/**
 * A raster reference traced on the paper: a parallel `TraceValue` arm like
 * `PaintValue`, not a `Geom` and not a `CsgOperand`.
 */
export type ImageValue = {
  kind: "image";
  src: string;
  /** The bitmap pixel pinned to `world`; the two place the pre-rotation rect. */
  world: Vec2;
  anchor: Vec2;
  imageSize: { width: number; height: number };
  /**
   * State one side and the other follows from `imageSize`'s aspect; state both
   * and the picture stretches. The tape keeps the authored form so the inspector
   * can report what the file says — `imageRect` is the conversion.
   */
  targetSize: { width?: number; height?: number };
  rot: ImageRot;
  flip: 0 | 1;
  style: ImageStyle;
};

/**
 * Look dials, resolved on the value: `opacity` is alpha, `saturation` and
 * `contrast` are 1-is-unchanged multipliers.
 */
export type ImageStyle = {
  opacity: number;
  saturation: number;
  contrast: number;
};

/** Quarter turns. Not a free angle: the steps keep the rect axis-aligned at 0/180. */
export type ImageRot = 0 | 90 | 180 | 270;

/** Everything about a reference but its source: where it is pinned, how big the
 * bitmap is, how big to draw it, and the look. */
export type ImageOpts = {
  world: Vec2;
  anchor?: Vec2;
  imageSize: { width: number; height: number };
  targetSize: { width?: number; height?: number };
  rot?: ImageRot;
  flip?: 0 | 1;
  style?: Partial<ImageStyle>;
};

/** The look a call that states nothing gets: the bitmap as it is. */
export const DEFAULT_IMAGE_STYLE: ImageStyle = { opacity: 1, saturation: 1, contrast: 1 };

/** The style a call asks for, defaults filled in — passed through rather than
 * clamped, since `isFiniteImage` is what decides whether the result is drawable. */
export function imageStyle(opts: Partial<ImageOpts> | undefined): ImageStyle {
  const style = opts && typeof opts === "object" ? opts.style : undefined;
  return {
    opacity: dial(style?.opacity, DEFAULT_IMAGE_STYLE.opacity),
    saturation: dial(style?.saturation, DEFAULT_IMAGE_STYLE.saturation),
    contrast: dial(style?.contrast, DEFAULT_IMAGE_STYLE.contrast),
  };
}

/** A non-number prop falls back to its default; an explicit NaN stays one, so a
 * broken computed value stops drawing instead of drawing at full strength. */
function dial(value: unknown, fallback: number): number {
  return typeof value === "number" ? value : fallback;
}

/** The world rect a reference occupies: its minimum corner, growing `+w`/`+h`. */
export type ImageRect = { x: number; y: number; w: number; h: number };

export function num(value: unknown): number {
  return typeof value === "number" ? value : Number.NaN;
}

/** A number, or a default when the prop is not one. */
export function numOr(value: unknown, fallback: number): number {
  return typeof value === "number" ? value : fallback;
}

/** A rect that nothing can draw, pick or bound — the shape every bad call takes. */
function nanRect(): ImageRect {
  return { x: Number.NaN, y: Number.NaN, w: Number.NaN, h: Number.NaN };
}

/**
 * The world rect a call describes, or an all-NaN rect when the call describes
 * none: no target size, a non-positive side, a pixel size that is not one.
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

/** Drawable and pickable: a URL, a finite positive rect, finite numbers
 * elsewhere. A malformed reference stays on the tape like any other non-finite
 * value and simply does not draw. */
export function isFiniteImage(value: ImageValue): boolean {
  const rect = imageRect(value);
  return (
    typeof value.src === "string" &&
    value.src.length > 0 &&
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    rect.w > 0 &&
    rect.h > 0 &&
    Number.isFinite(value.rot) &&
    Number.isFinite(value.flip) &&
    Number.isFinite(value.style.opacity) &&
    value.style.opacity >= 0 &&
    Number.isFinite(value.style.saturation) &&
    value.style.saturation >= 0 &&
    Number.isFinite(value.style.contrast) &&
    value.style.contrast >= 0
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
 * The rect's four corners from `(x, y)`, walking `+w` then `+h`, rotated about
 * the rect's centre. On screen that reads bottom-left, bottom-right, top-right,
 * top-left.
 */
export function imageCorners(value: ImageValue): [Vec2, Vec2, Vec2, Vec2] {
  const rect = imageRect(value);
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const k = quarterTurns(value.rot);
  const cos = ROT_COS[k]!;
  const sin = ROT_SIN[k]!;
  const hw = rect.w / 2;
  const hh = rect.h / 2;
  const at = (dx: number, dy: number): Vec2 => ({
    x: cx + dx * cos - dy * sin,
    y: cy + dx * sin + dy * cos,
  });
  return [at(-hw, -hh), at(hw, -hh), at(hw, hh), at(-hw, hh)];
}

/**
 * The quad in **strip order** — `a, b, d, c`: the strip's shared edge has to be
 * a diagonal to tile the rect. `flip` swaps the left/right pairs, so the rect
 * itself never moves.
 */
export function imageQuad(value: ImageValue): [Vec2, Vec2, Vec2, Vec2] {
  const [a, b, c, d] = imageCorners(value);
  return value.flip ? [b, a, c, d] : [a, b, d, c];
}

/** The corner each quad vertex samples, in `imageQuad` order; the picture's
 * top-left is the rect's `(x, y+h)` corner. */
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

/** Distance from `world` to the rotated rect, 0 inside — the same shape as
 * `distToRegion`, so an image picks like the filled thing it is. */
export function distToImage(value: ImageValue, world: Vec2): number {
  const rect = imageRect(value);
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const k = quarterTurns(value.rot);
  const cos = ROT_COS[k]!;
  const sin = ROT_SIN[k]!;
  const dx = world.x - cx;
  const dy = world.y - cy;
  // World → the rect's own frame: the inverse of the rotation `imageCorners` applies.
  const lx = dx * cos + dy * sin;
  const ly = -dx * sin + dy * cos;
  const ox = Math.abs(lx) - rect.w / 2;
  const oy = Math.abs(ly) - rect.h / 2;
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

/** Scale about `anchor` by `k`. Uniform, so it commutes with `rot`. */
export function scaleImage(value: ImageValue, about: Vec2, k: number): ImageValue {
  const { width, height } = value.targetSize;
  return {
    ...value,
    // `world` is a point *of* the picture — the anchor pixel — so scaling the
    // picture about `about` moves it exactly this far, and both stated sides
    // scale, which is what keeps a one-sided target in proportion.
    world: {
      x: about.x + (value.world.x - about.x) * k,
      y: about.y + (value.world.y - about.y) * k,
    },
    targetSize: {
      ...(width !== undefined ? { width: width * k } : {}),
      ...(height !== undefined ? { height: height * k } : {}),
    },
  };
}
