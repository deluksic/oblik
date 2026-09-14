/**
 * Column-major 4×4 matrices and the pixel-space bridge the text layer needs.
 *
 * There is no matrix type in this repo (no gl-matrix, no three), so this module
 * is deliberately small and pure: sixteen numbers in column-major order, the two
 * projections a text layer needs, and the one non-obvious conversion —
 * {@link pixelTransform} — that turns a world→clip matrix into something that
 * consumes glyph-local pixels.
 *
 * Nothing here imports TypeGPU, Solid, or a view: the math is the contract, and
 * the type of a matrix is only ever `Mat4`.
 */

/** Sixteen floats, column-major. `m[0..3]` is the first column. */
export type Mat4 = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

/** The projected anchor of a point, in homogeneous clip space. */
export type Clip4 = {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
};

/** A point in the plane a label lives on. `z` defaults to 0. */
export type Point3 = { readonly x: number; readonly y: number; readonly z?: number };

/**
 * The affine map from **glyph-local pixels** to homogeneous clip space.
 *
 * This is the shape glyph's `transformPosition` callback has to be:
 * `clip = localX·ex + localY·ey + origin`, where `ex`/`ey` are the clip-space
 * images of one pixel step and `origin` is the anchor's clip position.
 *
 * A perspective world→clip matrix is *not* affine, so the three vectors are
 * taken from the projective map's first-order expansion about the anchor. That
 * is exact for orthographic projections and for anything the glyf quad samples
 * at its own size, which is what a text quad needs.
 */
export type PixelTransform = {
  readonly origin: Clip4;
  /** Clip-space image of a +1 local-x step (right on screen). */
  readonly ex: Clip4;
  /** Clip-space image of a +1 local-y step (down on screen). */
  readonly ey: Clip4;
};

const { max, tan } = Math;

export function identity(): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

/** `a × b`, so `a` applies second (the usual `viewProj = proj × view`). */
export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out: number[] = [];
  for (let c = 0; c < 4; c += 1) {
    const b0 = b[c * 4]!;
    const b1 = b[c * 4 + 1]!;
    const b2 = b[c * 4 + 2]!;
    const b3 = b[c * 4 + 3]!;
    for (let r = 0; r < 4; r += 1) {
      out[c * 4 + r] = a[r]! * b0 + a[4 + r]! * b1 + a[8 + r]! * b2 + a[12 + r]! * b3;
    }
  }
  return out as unknown as Mat4;
}

/**
 * The pixel→clip matrix for a viewport, used as-is by the 2D path: glyph's
 * callback already hands over top-left, y-down logical pixels, which is exactly
 * this coordinate space. WebGPU clip space is y-up, so the y row is negated.
 */
export function orthoPixels(width: number, height: number): Mat4 {
  const w = max(1, width);
  const h = max(1, height);
  return [2 / w, 0, 0, 0, 0, -2 / h, 0, 0, 0, 0, 1, 0, -1, 1, 0, 1];
}

/**
 * The pane's camera as **one world→clip matrix**: the exact composite of
 * `worldToScreen` with {@link orthoPixels}, written down in closed form.
 *
 * This is what lets a label keep a world anchor. The text shader projects the
 * anchor through this matrix and adds the glyph's own quad through a separate,
 * camera-free pixel mapping, so a pan or a zoom is one 64-byte write and no
 * label is touched. Deriving it from `worldToScreen` rather than restating the
 * convention here is what keeps the GPU labels registered with the HTML overlay
 * that positions its text from the same function.
 *
 * `worldToScreen` is `screen = size/2 + (world − cam)·scale`, y flipped; the
 * pixel→clip half is {@link orthoPixels}. Substituting one into the other
 * cancels the pane half-size, leaving the scale and the camera centre below.
 */
export function paneProjection(camera: {
  readonly x: number;
  readonly y: number;
  readonly scale: number;
}, viewport: { readonly width: number; readonly height: number }): Mat4 {
  const w = max(1, viewport.width);
  const h = max(1, viewport.height);
  const k = 2 * camera.scale;
  return [
    k / w,
    0,
    0,
    0,
    0,
    k / h,
    0,
    0,
    0,
    0,
    1,
    0,
    -(k * camera.x) / w,
    -(k * camera.y) / h,
    0,
    1,
  ];
}

/**
 * A right-handed perspective projection. `fovY` is the full vertical field of
 * view in radians; the far plane maps to depth 1 (WebGPU's convention), so a
 * smaller `z` is nearer.
 */
export function perspective(fovY: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / tan(fovY / 2);
  const a = max(1e-6, aspect);
  const n = max(1e-6, near);
  const fa = max(n + 1e-6, far);
  const range = 1 / (n - fa);
  return [f / a, 0, 0, 0, 0, f, 0, 0, 0, 0, fa * range, -1, 0, 0, fa * n * range, 0];
}

/**
 * A look-at **view** matrix built directly in column-major order.
 *
 * The three basis vectors are written out rather than derived with cross
 * products so the handedness is visible: with the camera at `eye` looking down
 * `f = normalize(eye − target)`, y stays up and x is `right = up × f`.
 */
export function lookAt(
  eye: Point3,
  target: Point3,
  up: { readonly x: number; readonly y: number; readonly z: number },
): Mat4 {
  const ez = eye.z ?? 0;
  const tz = target.z ?? 0;
  let fx = eye.x - target.x;
  let fy = eye.y - target.y;
  let fz = ez - tz;
  const flen = max(1e-12, Math.hypot(fx, fy, fz));
  fx /= flen;
  fy /= flen;
  fz /= flen;
  // right = normalize(up × f)
  let rx = up.y * fz - up.z * fy;
  let ry = up.z * fx - up.x * fz;
  let rz = up.x * fy - up.y * fx;
  const rlen = max(1e-12, Math.hypot(rx, ry, rz));
  rx /= rlen;
  ry /= rlen;
  rz /= rlen;
  // trueUp = f × right
  const ux = fy * rz - fz * ry;
  const uy = fz * rx - fx * rz;
  const uz = fx * ry - fy * rx;
  return [
    rx,
    ux,
    fx,
    0,
    ry,
    uy,
    fy,
    0,
    rz,
    uz,
    fz,
    0,
    -(rx * eye.x + ry * eye.y + rz * ez),
    -(ux * eye.x + uy * eye.y + uz * ez),
    -(fx * eye.x + fy * eye.y + fz * ez),
    1,
  ];
}

/** The projective image of a point: `clip = m × (x, y, z, 1)`. */
export function project(m: Mat4, p: Point3): Clip4 {
  const z = p.z ?? 0;
  return {
    x: m[0]! * p.x + m[4]! * p.y + m[8]! * z + m[12]!,
    y: m[1]! * p.x + m[5]! * p.y + m[9]! * z + m[13]!,
    z: m[2]! * p.x + m[6]! * p.y + m[10]! * z + m[14]!,
    w: m[3]! * p.x + m[7]! * p.y + m[11]! * z + m[15]!,
  };
}

/**
 * The affine pixel→clip map for a label whose world plane is `m`.
 *
 * Glyph's vertex shader computes `clip = pixelTransform(anchor + (localX, localY))`
 * — one evaluation for the anchor and one per vertex, with no chance to correct
 * per-fragment. So the map is expanded about the anchor: {@link ex} and
 * {@link ey} are the clip-space images of one-pixel steps **in local glyph
 * coordinates** (x right, y down), and the anchor's own `w` is carried through
 * so the quad keeps its perspective divide.
 *
 * A point `d` pixels from the anchor in local coordinates lands at
 * `origin + d.x·ex + d.y·ey`.
 */
export function pixelTransform(m: Mat4, anchor: Point3): PixelTransform {
  const origin = project(m, anchor);
  const z = anchor.z ?? 0;
  return {
    origin,
    // A +1 local x step is +1 world x. Local y runs **down** the screen while
    // world y runs up, so a +1 local y step is a −1 world y step.
    ex: sub4(project(m, { x: anchor.x + 1, y: anchor.y, z }), origin),
    ey: sub4(project(m, { x: anchor.x, y: anchor.y - 1, z }), origin),
  };
}

function sub4(a: Clip4, b: Clip4): Clip4 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z, w: a.w - b.w };
}

/** True when the point is behind (or on) the camera, where the divide explodes. */
export function isBehind(clip: Clip4): boolean {
  return clip.w <= 1e-6;
}

/** Normalized device coordinates for a clip-space point, or `undefined` if behind. */
export function toNdc(clip: Clip4): { x: number; y: number } | undefined {
  if (isBehind(clip)) return undefined;
  return { x: clip.x / clip.w, y: clip.y / clip.w };
}
