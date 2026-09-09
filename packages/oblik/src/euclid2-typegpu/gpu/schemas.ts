import { f32, struct, u32, vec2f, vec3f } from "typegpu/data";
import type { Infer } from "typegpu/data";

/** Vertex layout of the vendored polyline expander (2 core + 4 per join triangle). */
export const MAX_JOIN_COUNT = 6;
export const STROKE_INDICES_PER_SEGMENT = 12 + 12 * MAX_JOIN_COUNT;

export const MAX_GRID_DRAWS = 2048;
export const MAX_STROKE_DRAWS = 4096;

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

/** Bit flags on StrokeRun.flags. */
export const RUN_MUTED = 1 << 0;
export const RUN_DASHED = 1 << 1;

export const StrokeCtrl = struct({
  position: vec2f,
  /** Half width in world units; negative disconnects the run. */
  radius: f32,
});
export type StrokeCtrlValue = Infer<typeof StrokeCtrl>;

export const StrokeRun = struct({
  color: vec3f,
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
