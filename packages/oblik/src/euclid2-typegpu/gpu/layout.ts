import { tgpu } from "typegpu";
import { arrayOf, u32 } from "typegpu/data";

import {
  CircleInst,
  FillEdge,
  FillRegion,
  Frame,
  GridSpan,
  MAX_CIRCLES,
  MAX_FILL_EDGES,
  MAX_FILL_REGIONS,
  MAX_POINTS,
  MAX_STROKE_DRAWS,
  PointInst,
  StrokeDraw,
} from "./schemas";

/** One bind group layout per pipeline: WebGPU caps storage buffers at 8 per
 * shader stage, and a pipeline counts every binding its layout makes visible,
 * so each pipeline binds only the buffers its shaders actually read. The
 * `frame` uniform is repeated per layout and shared buffer across groups. */

export const gridLayout = tgpu.bindGroupLayout({
  frame: { uniform: Frame },
  gridSpan: { uniform: GridSpan },
});

export const strokeLayout = tgpu.bindGroupLayout({
  frame: { uniform: Frame },
  strokes: { storage: arrayOf(StrokeDraw, MAX_STROKE_DRAWS) },
  strokeOrder: { storage: arrayOf(u32, MAX_STROKE_DRAWS) },
});

export const circleLayout = tgpu.bindGroupLayout({
  frame: { uniform: Frame },
  circles: { storage: arrayOf(CircleInst, MAX_CIRCLES) },
  circleOrder: { storage: arrayOf(u32, MAX_CIRCLES) },
});

export const fillLayout = tgpu.bindGroupLayout({
  frame: { uniform: Frame },
  fills: { storage: arrayOf(FillRegion, MAX_FILL_REGIONS) },
  fillOrder: { storage: arrayOf(u32, MAX_FILL_REGIONS) },
  fillEdges: { storage: arrayOf(FillEdge, MAX_FILL_EDGES) },
});

export const diskLayout = tgpu.bindGroupLayout({
  frame: { uniform: Frame },
  points: { storage: arrayOf(PointInst, MAX_POINTS) },
  pointOrder: { storage: arrayOf(u32, MAX_POINTS) },
});
