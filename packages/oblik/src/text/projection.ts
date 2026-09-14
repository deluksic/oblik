/**
 * Column-major 4×4 matrices, and the one projection a text layer needs.
 *
 * There is no matrix type in this repo (no gl-matrix, no three), so this module
 * is deliberately small and pure: sixteen numbers in column-major order, and the
 * pane's camera written as a single world→clip map.
 *
 * That is all that is left of it. Until labels kept a world anchor, a text layer
 * also needed a *pixel-space* bridge — a screen projection plus an affine
 * glyph-local-pixel map, because glyph's shader added the camera and the glyph's
 * own pixels together and the CPU had to pre-project every label. Owning the
 * vertex stage removed that: the camera now applies to the anchor and the pixels
 * are added camera-free, so the only thing a caller has to build is the matrix
 * itself.
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

const { max } = Math;

/**
 * The pane's camera as **one world→clip matrix**: the exact composite of
 * `worldToScreen` with the pixel→clip convention the pane draws in, written down
 * in closed form.
 *
 * This is what lets a label keep a world anchor. The text shader projects the
 * anchor through this matrix and adds the glyph's own quad through a separate,
 * camera-free pixel mapping, so a pan or a zoom is one 64-byte write and no
 * label is touched. Deriving it from `worldToScreen` rather than restating the
 * convention here is what keeps the GPU labels registered with the HTML overlay
 * that positions its text from the same function.
 *
 * `worldToScreen` is `screen = size/2 + (world − cam)·scale`, y flipped. Half a
 * viewport pixel is `2/width` in x and `-2/height` in y; substituting one into
 * the other cancels the pane half-size, leaving the scale and the camera centre
 * below.
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
