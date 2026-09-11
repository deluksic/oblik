import { f32, struct, u32, vec2f, vec2u, vec3f, vec4f } from "typegpu/data";
import type { Infer } from "typegpu/data";

/** Vertex layout of the vendored polyline expander (2 core + 4 per join triangle). */
export const MAX_JOIN_COUNT = 6;
export const STROKE_INDICES_PER_SEGMENT = 12 + 12 * MAX_JOIN_COUNT;

export const MAX_STROKE_DRAWS = 4096;
export const MAX_CIRCLES = 512;
/** Fan pieces per circle/arc instance; verts = 2·(pieces+1) ≤ 258. */
export const MAX_CIRCLE_PIECES = 128;
export const MAX_FILL_REGIONS = 256;
/** Straight boundary spans of the span-pass fills — the record the fill
 * fragment walk reads most: 16 B per span, so doubling the old combined cap
 * (4096 fat records) still costs less memory. The demo's span path holds ~3 k. */
export const MAX_FILL_SEGS = 8192;
/** Arc boundary spans of the span-pass fills; rare (≤ 50 in the demo) because
 * arcs are their own record kind now, so they get their own gate. */
export const MAX_FILL_ARCS = 1024;
/** Instanced disc slots (up to 4 per point node: halo ring, knockout, paper
 * outline, paint); shared by all layered discs of a point. */
export const MAX_POINTS = 4096;
/** Screen-space square markers (snap diamonds and friends). */
export const MAX_MARKERS = 256;
/** One draw per GPU-compiled CSG field (a `csg2` fill node). */
export const MAX_FIELD_QUADS = 512;
/** Leaf parameters across all compiled fields (≤ ~8 leaves per node). */
export const MAX_FIELD_LEAVES = 4096;
/** Boundary spans inside compiled fields. Region fills compile to a single
 * `spans` leaf, so this pool carries the region load the span pass used to. */
export const MAX_FIELD_SEGS = 8192;
export const MAX_FIELD_ARCS = 2048;
/** Raster references drawn as textured quads, one slot each. */
export const MAX_IMAGES = 64;

/** Camera + pane state; k = 2·scale/max(1, pane.y) recovers euclid2/camera.ts NDC mapping. */
export const Frame = struct({
  cam: vec2f,
  scale: f32,
  pane: vec2f,
  dpr: f32,
  /** Dash/gap lengths in CSS px. */
  dash: vec2f,
  knockoutPx: f32,
  outlinePx: f32,
});
export type FrameValue = Infer<typeof Frame>;

/** One uniform written per view sync: the grid's integer windows. The vertex
 * shader derives every hairline position from these — the CPU only counts. */
export const GridSpan = struct({
  /** First retained line coordinate per direction (window start after trimming). */
  first: vec2f,
  /** Full window rectangle; every hairline spans lo..hi along its long axis. */
  lo: vec2f,
  hi: vec2f,
  /** Retained line counts: x vertical lines (world x = first.x + i), y horizontal. */
  counts: vec2u,
  /** Axis visibility: x = world x=0 vertical axis in window, y = world y=0 horizontal. */
  axis: vec2u,
});
export type GridSpanValue = Infer<typeof GridSpan>;

/** Bit flags on StrokeRun.flags. */
export const RUN_MUTED = 1 << 0;
export const RUN_DASHED = 1 << 1;
/** Instance geometry is a plain two-point segment (lineVariableWidth on b→c),
 * not the mirrored-neighbour polyline encoding. */
export const RUN_GEOM_TWO_POINT = 1 << 2;

export const StrokeCtrl = struct({
  position: vec2f,
  /** Half width in CSS px (see `MarkerInst`); negative disconnects the run. */
  radiusPx: f32,
});
export type StrokeCtrlValue = Infer<typeof StrokeCtrl>;

export const StrokeRun = struct({
  color: vec3f,
  alpha: f32,
  /** Ctrl-point range within the run's ctrl array (adapter bookkeeping). */
  start: u32,
  count: u32,
  flags: u32,
});
export type StrokeRunValue = Infer<typeof StrokeRun>;

/** One instanced polyline segment: 4 ctrl points (prev, from, to, next). */
export const StrokeDraw = struct({
  a: StrokeCtrl,
  b: StrokeCtrl,
  c: StrokeCtrl,
  d: StrokeCtrl,
  run: StrokeRun,
});
export type StrokeDrawValue = Infer<typeof StrokeDraw>;

/** One layered disc of a point/glider mark: paint, paper outline, knockout,
 * or hover/select halo. Instances draw in `pointOrder` so discs stack
 * back-to-front like the SVG PointMark; radiusPx <= 0 culls the disc. */
export const PointInst = struct({
  center: vec2f,
  /** Disc radius in CSS px. */
  radiusPx: f32,
  color: vec3f,
  alpha: f32,
});
export type PointInstValue = Infer<typeof PointInst>;

/** One screen-space square marker: `center` is world, the extents are CSS px
 * along the square's local axes, `angle` rotates in screen space (π/4 draws a
 * diamond). The band between `halfInner` and `halfOuter` paints `stroke`, the
 * inside paints `fill`. */
export const MarkerInst = struct({
  center: vec2f,
  halfInner: f32,
  halfOuter: f32,
  angle: f32,
  fill: vec3f,
  stroke: vec3f,
  alpha: f32,
});
export type MarkerInstValue = Infer<typeof MarkerInst>;

/** Analytic stroked circle/arc: the annulus `radius ± halfPx` swept a0→a1
 * (a1 < a0 = CW). `radius` is world — the node's own geometry, which no zoom
 * touches — while the *band* width is CSS px. The fan's piece count follows from
 * both plus the zoom, so the vertex shader derives it; nothing in the record
 * depends on the camera. `halfPx <= 0` culls the instance. */
export const CircleInst = struct({
  center: vec2f,
  radius: f32,
  halfPx: f32,
  a0: f32,
  a1: f32,
  color: vec3f,
  alpha: f32,
  flags: u32,
});
export type CircleInstValue = Infer<typeof CircleInst>;

/** One straight fill boundary span, `a → b`: 16 B, and the fragment's segment
 * loop needs nothing else — no carrier, no branch. */
export const FillSeg = struct({
  a: vec2f,
  b: vec2f,
});
export type FillSegValue = Infer<typeof FillSeg>;

/** One arc fill boundary span on a circle carrier, swept `span` from `a` to `b`
 * (signed: negative sweeps clockwise). Kept out of `FillSeg` so the segment
 * loop never pays for the carrier a straight edge cannot have. */
export const FillArc = struct({
  a: vec2f,
  b: vec2f,
  center: vec2f,
  radius: f32,
  span: f32,
});
export type FillArcValue = Infer<typeof FillArc>;

/** SDF fragment quad covering one fill island; spans live in shared arrays, one
 * window per record kind. The halo fields are the node's chrome (see
 * `FieldQuad`): a halo run reads the same record with the boundary band
 * fragment, so no second record or window is needed. */
export const FillRegion = struct({
  aabbMin: vec2f,
  aabbMax: vec2f,
  segOffset: u32,
  segCount: u32,
  arcOffset: u32,
  arcCount: u32,
  color: vec3f,
  alpha: f32,
  flags: u32,
  /** The fill's own outline: rgb = state color (ink → accent when editable →
   * `selectedPaint` when hot, the SVG `inkClass` mapping), a = opacity (0 = no
   * outline). Centred on the boundary, like the SVG stroke. */
  edge: vec4f,
  /** Outline width in CSS px (`--oblik-stroke`), half of it inside the
   * silhouette. */
  edgeWidthPx: f32,
  /** rgb = ring color (`--oblik-ring`), a = ring opacity (0 = no halo). */
  haloRing: vec4f,
  /** rgb = knockout color (`--oblik-knockout`, the paper), a = opacity of the
   * paper band inside the ring (0 = none). The ring band itself is always
   * paper-backed: that is what knocks the fill's own paint out. */
  haloKnock: vec4f,
  /** (knockout width, ring width) in CSS px, both measured inward from the
   * fill's edge: the ring covers the first `y`, the paper the next `x`. */
  haloHalfPx: vec2f,
});
export type FillRegionValue = Infer<typeof FillRegion>;

/** One leaf of a GPU-compiled CSG field, addressed by a comptime index: a
 * circle (centre + radius), a half-plane (origin + pre-rotated inside normal),
 * an offset distance (`r`), or a window into the field's span arrays (a region
 * boundary walk). Which fields are live is decided by the compiled shape. */
export const FieldLeaf = struct({
  a: vec2f,
  b: vec2f,
  r: f32,
  segOffset: u32,
  segCount: u32,
  arcOffset: u32,
  arcCount: u32,
});
export type FieldLeafValue = Infer<typeof FieldLeaf>;

/** One compiled-field draw: the tree's AABB quad, the leaf window it reads
 * (`leafBase + comptime index`), and the flat fill color/alpha. Everything a
 * drag changes lives here or in the leaves — never in the shader. The halo
 * fields mirror `FillRegion`: the same quad drawn by the halo fragment paints
 * the SVG outside-clipped ring/knockout band instead of the fill. */
export const FieldQuad = struct({
  aabbMin: vec2f,
  aabbMax: vec2f,
  leafBase: u32,
  color: vec3f,
  alpha: f32,
  edge: vec4f,
  edgeWidthPx: f32,
  haloRing: vec4f,
  haloKnock: vec4f,
  haloHalfPx: vec2f,
});
export type FieldQuadValue = Infer<typeof FieldQuad>;

/** One raster reference: the four world corners in triangle-strip draw order
 * (vertex 0 samples uv (0,0), then (1,0), (1,1), (0,1)), already rotated and
 * flipped on the CPU — so the shader has a quad to sample and nothing else.
 * `fade` mixes the sampled colour toward the theme's paper, which lives in
 * `ImageTheme`. One instance per node; the texture itself is bound per draw, so
 * nothing here names a source. */
export const ImageInst = struct({
  a: vec2f,
  b: vec2f,
  c: vec2f,
  d: vec2f,
  fade: f32,
});
export type ImageInstValue = Infer<typeof ImageInst>;

/** The image layer's own uniform: the colour a faded reference mixes toward.
 * Separate from `Frame` so a theme switch is one 16-byte write and never a
 * frame rewrite, and separate from the pipeline (unlike the grid's colour slot)
 * because the image pipelines are per-texture and outlive a theme. */
export const ImageTheme = struct({
  paper: vec3f,
});
export type ImageThemeValue = Infer<typeof ImageTheme>;
