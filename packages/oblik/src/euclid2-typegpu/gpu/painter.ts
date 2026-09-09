import type { TgpuRoot } from "typegpu";
import { arrayOf, u32, vec2f, vec2u } from "typegpu/data";

import type { Camera2, PaneSize } from "../../euclid2/camera";
import type { TickPatch } from "./adapter";
import { makeFrameValue } from "./frame";
import { worldLayout } from "./layout";
import {
  createCirclePipelines,
  CIRCLE_VERTEX_COUNT,
  type CirclePipelines,
} from "./pipelines/circles";
import { createFillPipelines, FILL_QUAD_VERTICES, type FillPipelines } from "./pipelines/fills";
import {
  buildGridSpan,
  createGridPipelines,
  GRID_HAIRLINE_VERTICES,
  type GridPipelines,
} from "./pipelines/grid";
import { createStrokePipelines, type StrokePipelines } from "./pipelines/strokes";
import type { Rgba } from "./renderer";
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

export type Painter = {
  /** Write the Frame uniform and recount the visible grid lines for the new view
   * state (the grid's geometry itself is generated in the vertex shader). */
  sync(cam: Camera2, size: PaneSize, dpr: number): void;
  /** Apply an adapter patch: per-kind slot writes + wholesale order lists. */
  applyPatch(patch: TickPatch): void;
  /** Swap the theme-dependent colors (paper clear + grid/axis) and rebuild the
   * grid/axis pipelines, whose colors are baked in at creation. */
  setTheme(paper: Rgba, gridColors: GridColors): void;
  /** Record the clear + grid + axis + fills + strokes + circles passes and submit.
   * `resolveOverride` redirects the MSAA resolve away from the swapchain
   * (offscreen capture). */
  draw(
    renderer: {
      root: TgpuRoot;
      msaaView(): GPUTextureView;
      swapchainView(): GPUTextureView;
    },
    resolveOverride?: GPUTextureView,
  ): void;
  destroy(): void;
};

export type GridColors = {
  grid: readonly [number, number, number];
  axis: readonly [number, number, number];
};

export function createPainter(opts: {
  root: TgpuRoot;
  format: GPUTextureFormat;
  paper: Rgba;
  gridColors: GridColors;
}): Painter {
  const { root } = opts;

  const frameBuffer = root
    .createBuffer(Frame, makeFrameValue({ x: 0, y: 0, scale: 48 }, { w: 800, h: 600 }, 1))
    .$usage("uniform");
  const strokeBuffer = root.createBuffer(arrayOf(StrokeDraw, MAX_STROKE_DRAWS)).$usage("storage");
  const strokeOrderBuffer = root.createBuffer(arrayOf(u32, MAX_STROKE_DRAWS)).$usage("storage");
  const circleBuffer = root.createBuffer(arrayOf(CircleInst, MAX_CIRCLES)).$usage("storage");
  const circleOrderBuffer = root.createBuffer(arrayOf(u32, MAX_CIRCLES)).$usage("storage");
  const fillBuffer = root.createBuffer(arrayOf(FillRegion, MAX_FILL_REGIONS)).$usage("storage");
  const fillOrderBuffer = root.createBuffer(arrayOf(u32, MAX_FILL_REGIONS)).$usage("storage");
  const fillEdgeBuffer = root.createBuffer(arrayOf(FillEdge, MAX_FILL_EDGES)).$usage("storage");
  const gridSpanBuffer = root
    .createBuffer(
      GridSpan,
      GridSpan({
        first: vec2f(0, 0),
        lo: vec2f(0, 0),
        hi: vec2f(0, 0),
        counts: vec2u(0, 0),
        axis: vec2u(0, 0),
      }),
    )
    .$usage("uniform");

  const bindGroup = root.createBindGroup(worldLayout, {
    frame: frameBuffer,
    gridSpan: gridSpanBuffer,
    strokes: strokeBuffer,
    strokeOrder: strokeOrderBuffer,
    circles: circleBuffer,
    circleOrder: circleOrderBuffer,
    fills: fillBuffer,
    fillOrder: fillOrderBuffer,
    fillEdges: fillEdgeBuffer,
  });

  const pipelines: StrokePipelines = createStrokePipelines(root, bindGroup, opts.format);
  const circles: CirclePipelines = createCirclePipelines(root, bindGroup, opts.format);
  const fills: FillPipelines = createFillPipelines(root, bindGroup, opts.format);
  const grids: GridPipelines = createGridPipelines(root, bindGroup, opts.format, opts.gridColors);

  let strokeCount = 0;
  let gridLines = 0;
  let axesVisible = false;
  let circleCount = 0;
  let fillCount = 0;

  // Theme colors are mutable: `setTheme` swaps them without recreating the
  // painter. Grid/axis colors live in pipelines, so they are rebuilt there.
  let paper = opts.paper;
  let gridColors = opts.gridColors;

  return {
    setTheme(nextPaper, nextGridColors) {
      paper = nextPaper;
      gridColors = nextGridColors;
      grids.setColors(gridColors);
    },
    sync(cam, size, dpr) {
      frameBuffer.write(makeFrameValue(cam, size, dpr));
      const span = buildGridSpan(cam, size);
      gridSpanBuffer.write(
        GridSpan({
          first: vec2f(span.first.x, span.first.y),
          lo: vec2f(span.lo.x, span.lo.y),
          hi: vec2f(span.hi.x, span.hi.y),
          counts: vec2u(span.counts.x, span.counts.y),
          axis: vec2u(span.axis.x, span.axis.y),
        }),
      );
      gridLines = span.counts.x + span.counts.y;
      axesVisible = span.axis.x + span.axis.y > 0;
    },
    applyPatch(patch) {
      strokeBuffer.writePartial(patch.strokes.writes);
      strokeOrderBuffer.write(patch.strokes.order);
      strokeCount = patch.strokes.count;
      circleBuffer.writePartial(patch.circles.writes);
      circleOrderBuffer.write(patch.circles.order);
      circleCount = patch.circles.count;
      fillBuffer.writePartial(patch.fills.writes);
      fillOrderBuffer.write(patch.fills.order);
      fillCount = patch.fills.count;
      fillEdgeBuffer.writePartial(patch.fillEdges.writes);
    },
    draw(renderer, resolveOverride) {
      const encoder = renderer.root.device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: renderer.msaaView(),
            resolveTarget: resolveOverride ?? renderer.swapchainView(),
            clearValue: paper,
            loadOp: "clear",
            storeOp: "store",
          },
        ],
      });
      if (gridLines > 0) grids.grid(pass).draw(GRID_HAIRLINE_VERTICES, gridLines);
      // Axes land on top of the grid (still under world ink).
      if (axesVisible) grids.axis(pass).draw(GRID_HAIRLINE_VERTICES, 2);
      if (fillCount > 0) fills.fills(pass).draw(FILL_QUAD_VERTICES, fillCount);
      const strokePass = pipelines.strokes(pass);
      strokePass.drawIndexed(pipelines.indexCount, strokeCount);
      if (circleCount > 0) circles.circles(pass).draw(CIRCLE_VERTEX_COUNT, circleCount);
      pass.end();
      renderer.root.device.queue.submit([encoder.finish()]);
    },
    destroy() {
      pipelines.destroy();
      fills.destroy();
      grids.destroy();
      frameBuffer.destroy();
      strokeBuffer.destroy();
      strokeOrderBuffer.destroy();
      circleBuffer.destroy();
      circleOrderBuffer.destroy();
      fillBuffer.destroy();
      fillOrderBuffer.destroy();
      fillEdgeBuffer.destroy();
      gridSpanBuffer.destroy();
    },
  };
}
