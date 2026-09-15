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
/** Pooled mark slots: one per point/glider node, whose four disc layers the
 * shader derives from the record and the frame's chrome. */
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

/**
 * The band widths and the palette a pooled ink record derives its layer from.
 *
 * A record says what is true of the *node* — its geometry, its own half width,
 * its hot/selected/editable/muted bits — and the band says which layer is being
 * drawn. What is left between the two is what every band shares and no record
 * can know: the chrome widths and the colours they are painted in. Those live
 * here rather than in the records because they are a function of the theme and
 * the chrome metrics, not of any node, so re-theming the pane rewrites one
 * uniform and no record at all.
 *
 * There is deliberately no `paintHalfPx`: a layer's own half width is the
 * record's, which is what lets the tool overlay draw these very records at its
 * own weights (dash caps, arrow shafts, snap rings) without a second schema.
 */
export const Chrome = struct({
  /** Half widths, CSS px: the hot ring, and the paper knockout inside it. */
  haloHalfPx: f32,
  knockHalfPx: f32,
  /** A mark's ring/knockout/rim radius measured *from* its paint radius, CSS px. */
  pointRingAddPx: f32,
  pointKnockAddPx: f32,
  pointOutlineAddPx: f32,
  /** Ring opacity while hovered, and while selected. */
  hoverAlpha: f32,
  selectAlpha: f32,
  /** Element opacity of muted ink (chrome.mutePoints/scope), the one the SVG
   * writes as `.muted`. */
  mutedAlpha: f32,
  /** The palette a record's state selects from (see `STATE_*`), in the theme's
   * own terms: `--oblik-ink`, `--oblik-accent`, `--oblik-selected-paint`,
   * `--oblik-ring`, `--oblik-paper`. */
  ink: vec3f,
  accent: vec3f,
  selectedPaint: vec3f,
  ring: vec3f,
  paper: vec3f,
});
export type ChromeValue = Infer<typeof Chrome>;

// -- ink layers and record state ---------------------------------------------

/**
 * The only layer numbering there is.
 *
 * Every band, both pooled-record shaders, and every kind that still keeps one
 * record per layer (circles) names its layers through these five. Two parallel
 * numberings is how the stroke rest band once asked for layer 0 — a halo width
 * on a cold stroke — and drew nothing at all; a kind that cannot use a layer
 * maps it by name (`inkSlotOf` in `bands.ts`) instead of renumbering.
 */
export const LAYER_HALO = 0;
export const LAYER_KNOCKOUT = 1;
/** A mark's always-on paper rim. Not an SVG chrome layer: the SVG paints it as
 * the stroke of the mark itself, which is why it is the one layer that sits
 * between the knockout and the paint. */
export const LAYER_OUTLINE = 2;
export const LAYER_PAINT = 3;
export const LAYER_COUNT = 4;

/**
 * Bits on a pooled record's `state` word, shared by strokes and marks: the same
 * bit means the same thing in both shaders, and the colour a bit selects comes
 * from the frame's `Chrome` uniform, never from the record. So a hover, a
 * select, an editability flip or a theme switch rewrites at most the state word
 * — and a theme switch rewrites no record at all.
 */
export const STATE_HOT = 1 << 0;
export const STATE_SELECTED = 1 << 1;
export const STATE_EDITABLE = 1 << 2;
export const STATE_MUTED = 1 << 3;
/** The record's own `color`/`alpha` are the layer's, not a state the shader
 * derives: the tool overlay's ghosts, previews and dash caps carry colours and
 * alphas that no state bit and no palette entry express. Scene ink never sets
 * it, so its colour lane stays empty. */
export const STATE_EXPLICIT = 1 << 4;

/**
 * One ink stroke node, as a single record.
 *
 * The node's visible run is a two-point segment, so the record carries the run
 * itself rather than the mirrored-neighbour ctrl points a four-point polyline
 * needed. Its three chrome layers are no longer three records: the record says
 * what is true of the node and the band says which layer is drawing, which is
 * why a stroke builds one record per frame instead of three (`bands.ts`).
 * Widths are CSS px like every other record here, so a zoom reprojects the
 * world instead of rewriting it.
 */
export const StrokeNode = struct({
  /** Endpoints of the visible run, in world units. */
  a: vec2f,
  b: vec2f,
  /** Half width of the paint, CSS px. */
  halfPx: f32,
  state: u32,
  /** The layer's own colour: read only when `STATE_EXPLICIT` is set. */
  color: vec3f,
  alpha: f32,
});
export type StrokeNodeValue = Infer<typeof StrokeNode>;

/** One point/glider mark, as a single record: the four concentric discs the SVG
 * PointMark composes become four *layers* of one record, each band offsetting
 * its radius from `markRadiusPx` by a width the frame carries. */
export const PointNode = struct({
  center: vec2f,
  /** The paint disc's radius, CSS px. */
  markRadiusPx: f32,
  state: u32,
  color: vec3f,
  alpha: f32,
});
export type PointNodeValue = Infer<typeof PointNode>;

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

/**
 * The three style dials as a record of *named* scalars — they are three
 * different quantities, not one vector, and the schema is what keeps their
 * names on both sides of the boundary (`.z` would mean something else the day a
 * dial is added). The shader flattens them into three `flat` varyings only
 * because a WGSL varying cannot be a struct.
 */
export const ImageStyleFields = struct({
  opacity: f32,
  saturation: f32,
  contrast: f32,
});
export type ImageStyleFieldsValue = Infer<typeof ImageStyleFields>;

/** One raster reference: the four world corners in triangle-strip draw order
 * (the zig-zag `imageQuad` returns), already rotated and flipped on the CPU — so
 * the shader has a quad to sample and nothing else — plus the three style dials
 * it is drawn with. One instance per node; the texture itself is bound per draw,
 * so nothing here names a source, and nothing here names the paper: `opacity` is
 * alpha, so the blend against the cleared paper is what fades a reference. */
export const ImageInst = struct({
  a: vec2f,
  b: vec2f,
  c: vec2f,
  d: vec2f,
  /** The pre-rotation rect's world size — what turns the uv border into a world
   * distance for the selection outline. */
  size: vec2f,
  style: ImageStyleFields,
  /** The node's own outline: rgb = state colour, a = 0 for "no outline". A
   * reference has no ink of its own, so unlike a fill it carries none until it
   * is hovered or selected. */
  edge: vec4f,
  /** Outline width in CSS px. */
  edgeWidthPx: f32,
  /** The selection chrome, in the very fields a fill's halo uses — the shader
   * runs the same bands (`halo.ts`) over the quad's border instead of over a
   * boundary walk: rgb = ring colour, a = opacity; then the paper knockout
   * band; then (knockout width, ring width) in CSS px, both measured inward.
   * A reference carries none until it is hot. */
  haloRing: vec4f,
  haloKnock: vec4f,
  haloHalfPx: vec2f,
});
export type ImageInstValue = Infer<typeof ImageInst>;
