import { f32, struct, u32, vec2f, vec2u, vec3f } from "typegpu/data";
import type { Infer } from "typegpu/data";

/** Vertex layout of the vendored polyline expander (2 core + 4 per join triangle). */
export const MAX_JOIN_COUNT = 6;
export const STROKE_INDICES_PER_SEGMENT = 12 + 12 * MAX_JOIN_COUNT;

export const MAX_STROKE_DRAWS = 4096;
export const MAX_CIRCLES = 512;
/** Fan pieces per circle/arc instance; verts = 2·(pieces+1) ≤ 258. */
export const MAX_CIRCLE_PIECES = 128;
export const MAX_FILL_REGIONS = 256;
export const MAX_FILL_EDGES = 4096;
/** Instanced disc slots (up to 4 per point node: halo ring, knockout, paper
 * outline, paint); shared by all layered discs of a point. */
export const MAX_POINTS = 4096;
/** Screen-space square markers (snap diamonds and friends). */
export const MAX_MARKERS = 256;

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
  /** Half width in world units; negative disconnects the run. */
  radius: f32,
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
 * back-to-front like the SVG PointMark; radius <= 0 culls the disc. */
export const PointInst = struct({
  center: vec2f,
  radius: f32,
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

/** Analytic stroked circle/arc: annulus band r0→r1 swept a0→a1 (a1 < a0 = CW). */
export const CircleInst = struct({
  center: vec2f,
  r0: f32,
  r1: f32,
  a0: f32,
  a1: f32,
  /** Active fan pieces (≤ MAX_CIRCLE_PIECES); vertex shader clamps beyond. */
  pieces: f32,
  color: vec3f,
  alpha: f32,
  flags: u32,
});
export type CircleInstValue = Infer<typeof CircleInst>;

/** One fill boundary span: a circle-carrier arc (radius > 0, signed sweep
 * `span`) or a straight segment (radius <= 0, a→b). */
export const FillEdge = struct({
  a: vec2f,
  b: vec2f,
  center: vec2f,
  radius: f32,
  /** Signed sweep in radians for arcs; segment edges carry 0. */
  span: f32,
});
export type FillEdgeValue = Infer<typeof FillEdge>;

/** SDF fragment quad covering one fill island; edges live in a shared array. */
export const FillRegion = struct({
  aabbMin: vec2f,
  aabbMax: vec2f,
  edgeOffset: u32,
  edgeCount: u32,
  color: vec3f,
  alpha: f32,
  flags: u32,
});
export type FillRegionValue = Infer<typeof FillRegion>;
