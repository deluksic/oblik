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
  MAX_STROKE_DRAWS,
  StrokeDraw,
} from "./schemas";

export const worldLayout = tgpu.bindGroupLayout({
  frame: { uniform: Frame },
  gridSpan: { uniform: GridSpan },
  strokes: { storage: arrayOf(StrokeDraw, MAX_STROKE_DRAWS) },
  strokeOrder: { storage: arrayOf(u32, MAX_STROKE_DRAWS) },
  circles: { storage: arrayOf(CircleInst, MAX_CIRCLES) },
  circleOrder: { storage: arrayOf(u32, MAX_CIRCLES) },
  fills: { storage: arrayOf(FillRegion, MAX_FILL_REGIONS) },
  fillOrder: { storage: arrayOf(u32, MAX_FILL_REGIONS) },
  fillEdges: { storage: arrayOf(FillEdge, MAX_FILL_EDGES) },
});
