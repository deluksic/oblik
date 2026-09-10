import type { TgpuRoot } from "typegpu";
import { arrayOf, u32, vec2f, vec2u } from "typegpu/data";

import type { Camera2, PaneSize } from "../../euclid2/camera";
import type { FillDraw, TickPatch } from "./adapter";
import { FIELD_QUAD_VERTICES, fieldPipeline } from "./field/assemble";
import { makeFrameValue } from "./frame";
import {
  circleLayout,
  diskLayout,
  fieldLayout,
  fillLayout,
  gridLayout,
  markerLayout,
  strokeLayout,
} from "./layout";
import {
  createCirclePipelines,
  CIRCLE_VERTEX_COUNT,
  type CirclePipelines,
} from "./pipelines/circles";
import { createDiskPipelines, DISK_VERTEX_COUNT, type DiskPipelines } from "./pipelines/disks";
import { createFillPipelines, FILL_QUAD_VERTICES, type FillPipelines } from "./pipelines/fills";
import {
  buildGridSpan,
  createGridPipelines,
  GRID_HAIRLINE_VERTICES,
  type GridPipelines,
} from "./pipelines/grid";
import {
  createMarkerPipelines,
  MARKER_VERTEX_COUNT,
  type MarkerPipelines,
} from "./pipelines/markers";
import { createStrokePipelines, type StrokePipelines } from "./pipelines/strokes";
import type { Rgba } from "./renderer";
/** Sample count every pipeline in this painter is built for (renderer target). */
const MSAA_SAMPLES = 4;

import {
  CircleInst,
  FieldLeaf,
  FieldQuad,
  FillEdge,
  FillRegion,
  Frame,
  GridSpan,
  MarkerInst,
  MAX_CIRCLES,
  MAX_FIELD_EDGES,
  MAX_FIELD_LEAVES,
  MAX_FIELD_QUADS,
  MAX_FILL_EDGES,
  MAX_FILL_REGIONS,
  MAX_MARKERS,
  MAX_POINTS,
  MAX_STROKE_DRAWS,
  PointInst,
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
  /** Record the passes and submit. Order: clear, grid, axis, fills, then the
   * ink chrome bands back-to-front — rest paints, hover halos, hover paints,
   * lifted halos, lifted paints, strokes before circles within each band — so
   * a selected edge's chrome lands above hovered circles yet below points.
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
  // One order buffer per draw-order band; each band pipeline binds its own
  // buffer, and band instances always index their band from 0. The five bands
  // per kind mirror the SVG chrome pass order (rest, hover halo, hover paint,
  // lifted halo, lifted paint) so the painter can interleave strokes and
  // circles state-by-state instead of shape-by-shape.
  const strokeRestOrderBuffer = root.createBuffer(arrayOf(u32, MAX_STROKE_DRAWS)).$usage("storage");
  const strokeHoverHaloOrderBuffer = root
    .createBuffer(arrayOf(u32, MAX_STROKE_DRAWS))
    .$usage("storage");
  const strokeHoverPaintOrderBuffer = root
    .createBuffer(arrayOf(u32, MAX_STROKE_DRAWS))
    .$usage("storage");
  const strokeLiftedHaloOrderBuffer = root
    .createBuffer(arrayOf(u32, MAX_STROKE_DRAWS))
    .$usage("storage");
  const strokeLiftedPaintOrderBuffer = root
    .createBuffer(arrayOf(u32, MAX_STROKE_DRAWS))
    .$usage("storage");
  const circleBuffer = root.createBuffer(arrayOf(CircleInst, MAX_CIRCLES)).$usage("storage");
  const circleRestOrderBuffer = root.createBuffer(arrayOf(u32, MAX_CIRCLES)).$usage("storage");
  const circleHoverHaloOrderBuffer = root.createBuffer(arrayOf(u32, MAX_CIRCLES)).$usage("storage");
  const circleHoverPaintOrderBuffer = root
    .createBuffer(arrayOf(u32, MAX_CIRCLES))
    .$usage("storage");
  const circleLiftedHaloOrderBuffer = root
    .createBuffer(arrayOf(u32, MAX_CIRCLES))
    .$usage("storage");
  const circleLiftedPaintOrderBuffer = root
    .createBuffer(arrayOf(u32, MAX_CIRCLES))
    .$usage("storage");
  const pointBuffer = root.createBuffer(arrayOf(PointInst, MAX_POINTS)).$usage("storage");
  const pointOrderBuffer = root.createBuffer(arrayOf(u32, MAX_POINTS)).$usage("storage");
  const fillBuffer = root.createBuffer(arrayOf(FillRegion, MAX_FILL_REGIONS)).$usage("storage");
  const fillOrderBuffer = root.createBuffer(arrayOf(u32, MAX_FILL_REGIONS)).$usage("storage");
  const fillEdgeBuffer = root.createBuffer(arrayOf(FillEdge, MAX_FILL_EDGES)).$usage("storage");
  /** Compiled CSG fields: one AABB quad per fill node plus its leaf/edge windows. */
  const fieldQuadBuffer = root.createBuffer(arrayOf(FieldQuad, MAX_FIELD_QUADS)).$usage("storage");
  const fieldOrderBuffer = root.createBuffer(arrayOf(u32, MAX_FIELD_QUADS)).$usage("storage");
  const fieldLeafBuffer = root.createBuffer(arrayOf(FieldLeaf, MAX_FIELD_LEAVES)).$usage("storage");
  const fieldEdgeBuffer = root.createBuffer(arrayOf(FillEdge, MAX_FIELD_EDGES)).$usage("storage");

  // Tool overlay (ghost previews + snap markers). Rebuilt and rewritten every
  // tick, so each phase owns a full data buffer and an identity order list
  // (overlay instances are always contiguous from slot 0). `under` renders
  // between the grid and the world (trace previews), `over` above everything.
  const strokeOrderId = root
    .createBuffer(arrayOf(u32, MAX_STROKE_DRAWS), identityOrder(MAX_STROKE_DRAWS))
    .$usage("storage");
  const circleOrderId = root
    .createBuffer(arrayOf(u32, MAX_CIRCLES), identityOrder(MAX_CIRCLES))
    .$usage("storage");
  const pointOrderId = root
    .createBuffer(arrayOf(u32, MAX_POINTS), identityOrder(MAX_POINTS))
    .$usage("storage");
  const fillOrderId = root
    .createBuffer(arrayOf(u32, MAX_FILL_REGIONS), identityOrder(MAX_FILL_REGIONS))
    .$usage("storage");
  const underStrokesBuf = root
    .createBuffer(arrayOf(StrokeDraw, MAX_STROKE_DRAWS))
    .$usage("storage");
  const overStrokesBuf = root.createBuffer(arrayOf(StrokeDraw, MAX_STROKE_DRAWS)).$usage("storage");
  const underCirclesBuf = root.createBuffer(arrayOf(CircleInst, MAX_CIRCLES)).$usage("storage");
  const overCirclesBuf = root.createBuffer(arrayOf(CircleInst, MAX_CIRCLES)).$usage("storage");
  const overPointsBuf = root.createBuffer(arrayOf(PointInst, MAX_POINTS)).$usage("storage");
  const underFillsBuf = root.createBuffer(arrayOf(FillRegion, MAX_FILL_REGIONS)).$usage("storage");
  const overFillsBuf = root.createBuffer(arrayOf(FillRegion, MAX_FILL_REGIONS)).$usage("storage");
  const underEdgesBuf = root.createBuffer(arrayOf(FillEdge, MAX_FILL_EDGES)).$usage("storage");
  const overEdgesBuf = root.createBuffer(arrayOf(FillEdge, MAX_FILL_EDGES)).$usage("storage");
  // Screen-space square markers (snap diamonds): one instanced quad each,
  // rewritten per tick like the rest of the overlay.
  const markerBuffer = root.createBuffer(arrayOf(MarkerInst, MAX_MARKERS)).$usage("storage");
  const markerOrderId = root
    .createBuffer(arrayOf(u32, MAX_MARKERS), identityOrder(MAX_MARKERS))
    .$usage("storage");
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

  // One bind group per (pipeline layout × draw-order band) — each pipeline
  // sees only the buffers its shaders read (WebGPU caps storage buffers at 8
  // per shader stage), and each band draw reads its own order list from 0.
  const gridGroup = root.createBindGroup(gridLayout, {
    frame: frameBuffer,
    gridSpan: gridSpanBuffer,
  });
  const strokeRestGroup = root.createBindGroup(strokeLayout, {
    frame: frameBuffer,
    strokes: strokeBuffer,
    strokeOrder: strokeRestOrderBuffer,
  });
  const strokeHoverHaloGroup = root.createBindGroup(strokeLayout, {
    frame: frameBuffer,
    strokes: strokeBuffer,
    strokeOrder: strokeHoverHaloOrderBuffer,
  });
  const strokeHoverPaintGroup = root.createBindGroup(strokeLayout, {
    frame: frameBuffer,
    strokes: strokeBuffer,
    strokeOrder: strokeHoverPaintOrderBuffer,
  });
  const strokeLiftedHaloGroup = root.createBindGroup(strokeLayout, {
    frame: frameBuffer,
    strokes: strokeBuffer,
    strokeOrder: strokeLiftedHaloOrderBuffer,
  });
  const strokeLiftedPaintGroup = root.createBindGroup(strokeLayout, {
    frame: frameBuffer,
    strokes: strokeBuffer,
    strokeOrder: strokeLiftedPaintOrderBuffer,
  });
  const circleRestGroup = root.createBindGroup(circleLayout, {
    frame: frameBuffer,
    circles: circleBuffer,
    circleOrder: circleRestOrderBuffer,
  });
  const circleHoverHaloGroup = root.createBindGroup(circleLayout, {
    frame: frameBuffer,
    circles: circleBuffer,
    circleOrder: circleHoverHaloOrderBuffer,
  });
  const circleHoverPaintGroup = root.createBindGroup(circleLayout, {
    frame: frameBuffer,
    circles: circleBuffer,
    circleOrder: circleHoverPaintOrderBuffer,
  });
  const circleLiftedHaloGroup = root.createBindGroup(circleLayout, {
    frame: frameBuffer,
    circles: circleBuffer,
    circleOrder: circleLiftedHaloOrderBuffer,
  });
  const circleLiftedPaintGroup = root.createBindGroup(circleLayout, {
    frame: frameBuffer,
    circles: circleBuffer,
    circleOrder: circleLiftedPaintOrderBuffer,
  });
  const fillGroup = root.createBindGroup(fillLayout, {
    frame: frameBuffer,
    fills: fillBuffer,
    fillOrder: fillOrderBuffer,
    fillEdges: fillEdgeBuffer,
  });
  const fieldGroup = root.createBindGroup(fieldLayout, {
    frame: frameBuffer,
    fieldQuads: fieldQuadBuffer,
    fieldOrder: fieldOrderBuffer,
    fieldLeaves: fieldLeafBuffer,
    fieldEdges: fieldEdgeBuffer,
  });
  const diskGroup = root.createBindGroup(diskLayout, {
    frame: frameBuffer,
    points: pointBuffer,
    pointOrder: pointOrderBuffer,
  });
  const underStrokeGroup = root.createBindGroup(strokeLayout, {
    frame: frameBuffer,
    strokes: underStrokesBuf,
    strokeOrder: strokeOrderId,
  });
  const overStrokeGroup = root.createBindGroup(strokeLayout, {
    frame: frameBuffer,
    strokes: overStrokesBuf,
    strokeOrder: strokeOrderId,
  });
  const underCircleGroup = root.createBindGroup(circleLayout, {
    frame: frameBuffer,
    circles: underCirclesBuf,
    circleOrder: circleOrderId,
  });
  const overCircleGroup = root.createBindGroup(circleLayout, {
    frame: frameBuffer,
    circles: overCirclesBuf,
    circleOrder: circleOrderId,
  });
  const overDiskGroup = root.createBindGroup(diskLayout, {
    frame: frameBuffer,
    points: overPointsBuf,
    pointOrder: pointOrderId,
  });
  const underFillGroup = root.createBindGroup(fillLayout, {
    frame: frameBuffer,
    fills: underFillsBuf,
    fillOrder: fillOrderId,
    fillEdges: underEdgesBuf,
  });
  const overFillGroup = root.createBindGroup(fillLayout, {
    frame: frameBuffer,
    fills: overFillsBuf,
    fillOrder: fillOrderId,
    fillEdges: overEdgesBuf,
  });
  const markerGroup = root.createBindGroup(markerLayout, {
    frame: frameBuffer,
    marks: markerBuffer,
    markOrder: markerOrderId,
  });

  const strokeRest: StrokePipelines = createStrokePipelines(root, strokeRestGroup, opts.format);
  const strokeHoverHalo: StrokePipelines = createStrokePipelines(
    root,
    strokeHoverHaloGroup,
    opts.format,
  );
  const strokeHoverPaint: StrokePipelines = createStrokePipelines(
    root,
    strokeHoverPaintGroup,
    opts.format,
  );
  const strokeLiftedHalo: StrokePipelines = createStrokePipelines(
    root,
    strokeLiftedHaloGroup,
    opts.format,
  );
  const strokeLiftedPaint: StrokePipelines = createStrokePipelines(
    root,
    strokeLiftedPaintGroup,
    opts.format,
  );
  const circleRest: CirclePipelines = createCirclePipelines(root, circleRestGroup, opts.format);
  const circleHoverHalo: CirclePipelines = createCirclePipelines(
    root,
    circleHoverHaloGroup,
    opts.format,
  );
  const circleHoverPaint: CirclePipelines = createCirclePipelines(
    root,
    circleHoverPaintGroup,
    opts.format,
  );
  const circleLiftedHalo: CirclePipelines = createCirclePipelines(
    root,
    circleLiftedHaloGroup,
    opts.format,
  );
  const circleLiftedPaint: CirclePipelines = createCirclePipelines(
    root,
    circleLiftedPaintGroup,
    opts.format,
  );
  const disks: DiskPipelines = createDiskPipelines(root, diskGroup, opts.format);
  const fills: FillPipelines = createFillPipelines(root, fillGroup, opts.format);
  const grids: GridPipelines = createGridPipelines(root, gridGroup, opts.format, opts.gridColors);

  const underStrokes: StrokePipelines = createStrokePipelines(root, underStrokeGroup, opts.format);
  const overStrokes: StrokePipelines = createStrokePipelines(root, overStrokeGroup, opts.format);
  const underCircles: CirclePipelines = createCirclePipelines(root, underCircleGroup, opts.format);
  const overCircles: CirclePipelines = createCirclePipelines(root, overCircleGroup, opts.format);
  const overDisks: DiskPipelines = createDiskPipelines(root, overDiskGroup, opts.format);
  const underFills: FillPipelines = createFillPipelines(root, underFillGroup, opts.format);
  const overFills: FillPipelines = createFillPipelines(root, overFillGroup, opts.format);
  const markers: MarkerPipelines = createMarkerPipelines(root, markerGroup, opts.format);

  // Band sizes from the last applied patch (arrays are rewritten wholesale).
  let strokeRestCount = 0;
  let strokeHoverHaloCount = 0;
  let strokeHoverPaintCount = 0;
  let strokeLiftedHaloCount = 0;
  let strokeLiftedPaintCount = 0;
  let circleRestCount = 0;
  let circleHoverHaloCount = 0;
  let circleHoverPaintCount = 0;
  let circleLiftedHaloCount = 0;
  let circleLiftedPaintCount = 0;
  let gridLines = 0;
  let axesVisible = false;
  let pointCount = 0;
  /** World fill draws in band order (span fills and compiled fields mixed). */
  let fillDraws: readonly FillDraw[] = [];
  let underStrokeCount = 0;
  let underCircleCount = 0;
  let underFillCount = 0;
  let overStrokeCount = 0;
  let overCircleCount = 0;
  let overDiskCount = 0;
  let overFillCount = 0;
  let markerCount = 0;

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
      strokeRestOrderBuffer.write(patch.strokes.bands.rest);
      strokeHoverHaloOrderBuffer.write(patch.strokes.bands.hoverHalo);
      strokeHoverPaintOrderBuffer.write(patch.strokes.bands.hoverPaint);
      strokeLiftedHaloOrderBuffer.write(patch.strokes.bands.liftedHalo);
      strokeLiftedPaintOrderBuffer.write(patch.strokes.bands.liftedPaint);
      strokeRestCount = patch.strokes.bands.rest.length;
      strokeHoverHaloCount = patch.strokes.bands.hoverHalo.length;
      strokeHoverPaintCount = patch.strokes.bands.hoverPaint.length;
      strokeLiftedHaloCount = patch.strokes.bands.liftedHalo.length;
      strokeLiftedPaintCount = patch.strokes.bands.liftedPaint.length;
      circleBuffer.writePartial(patch.circles.writes);
      circleRestOrderBuffer.write(patch.circles.bands.rest);
      circleHoverHaloOrderBuffer.write(patch.circles.bands.hoverHalo);
      circleHoverPaintOrderBuffer.write(patch.circles.bands.hoverPaint);
      circleLiftedHaloOrderBuffer.write(patch.circles.bands.liftedHalo);
      circleLiftedPaintOrderBuffer.write(patch.circles.bands.liftedPaint);
      circleRestCount = patch.circles.bands.rest.length;
      circleHoverHaloCount = patch.circles.bands.hoverHalo.length;
      circleHoverPaintCount = patch.circles.bands.hoverPaint.length;
      circleLiftedHaloCount = patch.circles.bands.liftedHalo.length;
      circleLiftedPaintCount = patch.circles.bands.liftedPaint.length;
      pointBuffer.writePartial(patch.points.writes);
      pointOrderBuffer.write(patch.points.order);
      pointCount = patch.points.count;
      fillBuffer.writePartial(patch.fills.writes);
      fillOrderBuffer.write(patch.fills.order);
      fillEdgeBuffer.writePartial(patch.fillEdges.writes);
      fieldQuadBuffer.writePartial(patch.fields.quads.writes);
      fieldOrderBuffer.write(patch.fields.quads.order);
      fieldLeafBuffer.writePartial(patch.fields.leaves.writes);
      fieldEdgeBuffer.writePartial(patch.fields.edges.writes);
      fillDraws = patch.fillDraws;
      // Tool overlay: phase buffers are rewritten wholesale each tick (small
      // counts; the static identity order arrays need no writes). Sliced to
      // the fixed capacities so a runaway ghost can never overflow.
      const ov = patch.overlay;
      underStrokesBuf.writePartial(seqWrites(ov.under.strokes, MAX_STROKE_DRAWS));
      underStrokeCount = Math.min(MAX_STROKE_DRAWS, ov.under.strokes.length);
      underCirclesBuf.writePartial(seqWrites(ov.under.circles, MAX_CIRCLES));
      underCircleCount = Math.min(MAX_CIRCLES, ov.under.circles.length);
      underFillsBuf.writePartial(seqWrites(ov.under.fills, MAX_FILL_REGIONS));
      underEdgesBuf.writePartial(seqWrites(ov.under.edges, MAX_FILL_EDGES));
      underFillCount = Math.min(MAX_FILL_REGIONS, ov.under.fills.length);
      overStrokesBuf.writePartial(seqWrites(ov.over.strokes, MAX_STROKE_DRAWS));
      overStrokeCount = Math.min(MAX_STROKE_DRAWS, ov.over.strokes.length);
      overCirclesBuf.writePartial(seqWrites(ov.over.circles, MAX_CIRCLES));
      overCircleCount = Math.min(MAX_CIRCLES, ov.over.circles.length);
      overPointsBuf.writePartial(seqWrites(ov.over.disks, MAX_POINTS));
      overDiskCount = Math.min(MAX_POINTS, ov.over.disks.length);
      overFillsBuf.writePartial(seqWrites(ov.over.fills, MAX_FILL_REGIONS));
      overEdgesBuf.writePartial(seqWrites(ov.over.edges, MAX_FILL_EDGES));
      overFillCount = Math.min(MAX_FILL_REGIONS, ov.over.fills.length);
      markerBuffer.writePartial(seqWrites(ov.over.markers, MAX_MARKERS));
      markerCount = Math.min(MAX_MARKERS, ov.over.markers.length);
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
      // Trace previews of registered tools sit under the world, above the grid.
      if (underFillCount > 0) underFills.fills(pass).draw(FILL_QUAD_VERTICES, underFillCount);
      if (underStrokeCount > 0) {
        const p = underStrokes.strokes(pass);
        p.drawIndexed(underStrokes.indexCount, underStrokeCount);
      }
      if (underCircleCount > 0) {
        underCircles.circles(pass).draw(CIRCLE_VERTEX_COUNT, underCircleCount);
      }
      // World fills, in the band order the adapter emitted: each node is one
      // draw (a compiled field and a span fill are different pipelines), which
      // keeps translucent overlap compositing in SVG order.
      for (const draw of fillDraws) {
        if (draw.count === 0) continue;
        if (draw.path === "spans") {
          fills.fills(pass).draw(FILL_QUAD_VERTICES, draw.count, 0, draw.first);
        } else {
          fieldPipeline(root, fieldGroup, draw.plan, opts.format, MSAA_SAMPLES)
            .with(pass)
            .draw(FIELD_QUAD_VERTICES, draw.count, 0, draw.first);
        }
      }
      // Ink chrome bands, back-to-front per SVG pass order: every edge's paint
      // (rest), hover halos, hover paints, lifted halos, lifted paints —
      // strokes before circles within each band — so a selected edge's chrome
      // stacks above a hovered circle's paint, and points stay topmost.
      if (strokeRestCount > 0) {
        const p = strokeRest.strokes(pass);
        p.drawIndexed(strokeRest.indexCount, strokeRestCount);
      }
      if (circleRestCount > 0) {
        circleRest.circles(pass).draw(CIRCLE_VERTEX_COUNT, circleRestCount);
      }
      if (strokeHoverHaloCount > 0) {
        const p = strokeHoverHalo.strokes(pass);
        p.drawIndexed(strokeHoverHalo.indexCount, strokeHoverHaloCount);
      }
      if (circleHoverHaloCount > 0) {
        circleHoverHalo.circles(pass).draw(CIRCLE_VERTEX_COUNT, circleHoverHaloCount);
      }
      if (strokeHoverPaintCount > 0) {
        const p = strokeHoverPaint.strokes(pass);
        p.drawIndexed(strokeHoverPaint.indexCount, strokeHoverPaintCount);
      }
      if (circleHoverPaintCount > 0) {
        circleHoverPaint.circles(pass).draw(CIRCLE_VERTEX_COUNT, circleHoverPaintCount);
      }
      if (strokeLiftedHaloCount > 0) {
        const p = strokeLiftedHalo.strokes(pass);
        p.drawIndexed(strokeLiftedHalo.indexCount, strokeLiftedHaloCount);
      }
      if (circleLiftedHaloCount > 0) {
        circleLiftedHalo.circles(pass).draw(CIRCLE_VERTEX_COUNT, circleLiftedHaloCount);
      }
      if (strokeLiftedPaintCount > 0) {
        const p = strokeLiftedPaint.strokes(pass);
        p.drawIndexed(strokeLiftedPaint.indexCount, strokeLiftedPaintCount);
      }
      if (circleLiftedPaintCount > 0) {
        circleLiftedPaint.circles(pass).draw(CIRCLE_VERTEX_COUNT, circleLiftedPaintCount);
      }
      // Points/gliders land topmost (render model: fills → ink → points).
      if (pointCount > 0) disks.points(pass).draw(DISK_VERTEX_COUNT, pointCount);
      // Tool ghost + snap overlay above the world (SVG ghost/snap marks).
      if (overFillCount > 0) overFills.fills(pass).draw(FILL_QUAD_VERTICES, overFillCount);
      // Square markers (snap diamonds) sit under the ghost marks, above the
      // region ghost fill — mirroring the hud layer's PlaceSnap before GhostMark.
      if (markerCount > 0) markers.markers(pass).draw(MARKER_VERTEX_COUNT, markerCount);
      if (overStrokeCount > 0) {
        const p = overStrokes.strokes(pass);
        p.drawIndexed(overStrokes.indexCount, overStrokeCount);
      }
      if (overCircleCount > 0) overCircles.circles(pass).draw(CIRCLE_VERTEX_COUNT, overCircleCount);
      if (overDiskCount > 0) overDisks.points(pass).draw(DISK_VERTEX_COUNT, overDiskCount);
      pass.end();
      renderer.root.device.queue.submit([encoder.finish()]);
    },
    destroy() {
      strokeRest.destroy();
      strokeHoverHalo.destroy();
      strokeHoverPaint.destroy();
      strokeLiftedHalo.destroy();
      strokeLiftedPaint.destroy();
      underStrokes.destroy();
      overStrokes.destroy();
      fills.destroy();
      grids.destroy();
      frameBuffer.destroy();
      strokeBuffer.destroy();
      strokeRestOrderBuffer.destroy();
      strokeHoverHaloOrderBuffer.destroy();
      strokeHoverPaintOrderBuffer.destroy();
      strokeLiftedHaloOrderBuffer.destroy();
      strokeLiftedPaintOrderBuffer.destroy();
      circleBuffer.destroy();
      circleRestOrderBuffer.destroy();
      circleHoverHaloOrderBuffer.destroy();
      circleHoverPaintOrderBuffer.destroy();
      circleLiftedHaloOrderBuffer.destroy();
      circleLiftedPaintOrderBuffer.destroy();
      pointBuffer.destroy();
      pointOrderBuffer.destroy();
      fillBuffer.destroy();
      fillOrderBuffer.destroy();
      fillEdgeBuffer.destroy();
      fieldQuadBuffer.destroy();
      fieldOrderBuffer.destroy();
      fieldLeafBuffer.destroy();
      fieldEdgeBuffer.destroy();
      strokeOrderId.destroy();
      circleOrderId.destroy();
      pointOrderId.destroy();
      fillOrderId.destroy();
      underStrokesBuf.destroy();
      overStrokesBuf.destroy();
      underCirclesBuf.destroy();
      overCirclesBuf.destroy();
      overPointsBuf.destroy();
      underFillsBuf.destroy();
      overFillsBuf.destroy();
      underEdgesBuf.destroy();
      overEdgesBuf.destroy();
      markerBuffer.destroy();
      markerOrderId.destroy();
      gridSpanBuffer.destroy();
    },
  };
}

/** [0..n-1] — overlay instances are always contiguous from slot 0. */
function identityOrder(n: number): Uint32Array {
  const a = new Uint32Array(n);
  for (let i = 0; i < n; i++) a[i] = i;
  return a;
}

/** Contiguous slot writes 0..n-1 for a per-frame overlay buffer. */
function seqWrites<T>(items: readonly T[], max: number): { idx: number; value: T }[] {
  const out: { idx: number; value: T }[] = [];
  const n = Math.min(max, items.length);
  for (let i = 0; i < n; i++) out.push({ idx: i, value: items[i]! });
  return out;
}
