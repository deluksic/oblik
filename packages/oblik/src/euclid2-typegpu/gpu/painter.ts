import type { TgpuRoot } from "typegpu";
import { arrayOf, u32, vec2f, vec2u, vec3f } from "typegpu/data";
import type { v3f } from "typegpu/data";

import type { Camera2, PaneSize } from "../../euclid2/camera";
import type { FillDraw, TickPatch } from "./adapter";
import {
  INK_BAND_ORDER,
  instancesPerEntry,
  POINT_BAND_LAYERS,
  STROKE_BAND_LAYERS,
  type InkBandName,
} from "./bands";
import { FIELD_QUAD_VERTICES, fieldPipeline } from "./field/assemble";
import { makeFrameValue } from "./frame";
import { createImageLayer, type ImageDraw, type ImageLayer } from "./imageLayer";
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
import { writeRuns } from "./recordPool";
import type { Rgba } from "./renderer";
/** Sample count every pipeline in this painter is built for (renderer target). */
const MSAA_SAMPLES = 4;

import {
  Chrome,
  CircleInst,
  FieldLeaf,
  FieldQuad,
  FillArc,
  FillRegion,
  FillSeg,
  Frame,
  GridSpan,
  LAYER_PAINT,
  MarkerInst,
  MAX_CIRCLES,
  MAX_FIELD_ARCS,
  MAX_FIELD_LEAVES,
  MAX_FIELD_QUADS,
  MAX_FIELD_SEGS,
  MAX_FILL_ARCS,
  MAX_FILL_REGIONS,
  MAX_FILL_SEGS,
  MAX_MARKERS,
  MAX_POINTS,
  MAX_STROKE_DRAWS,
  PointNode,
  StrokeNode,
  type ChromeValue,
} from "./schemas";
import { spanWrites } from "./spanRecords";

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
   * (offscreen capture). `drawText` is the last recorder in the same pass, so
   * glyph text shares this frame's color attachment and its single MSAA
   * resolve instead of opening a second pass. */
  draw(
    renderer: {
      root: TgpuRoot;
      msaaView(): GPUTextureView;
      swapchainView(): GPUTextureView;
      /** References arrive asynchronously and ask for a frame when they do. */
      requestFrame(): void;
    },
    resolveOverride?: GPUTextureView,
    drawText?: (pass: GPURenderPassEncoder) => void,
  ): void;
  destroy(): void;
};

export /** Until a frame has been drawn there is no renderer to ask for one. */
const NO_FRAME = () => {};

type GridColors = {
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
  /** The band widths and the palette the record shaders derive their layers
   * from. The first patch always writes it, and after that only a theme or a
   * metric change does — so a camera move still writes one uniform. */
  const chromeBuffer = root.createBuffer(Chrome, blankChrome()).$usage("uniform");
  const strokeBuffer = root.createBuffer(arrayOf(StrokeNode, MAX_STROKE_DRAWS)).$usage("storage");
  // One order buffer per draw-order band; a band's entries are the slots its
  // nodes draw from, and band instances always index their band from 0. The
  // bands come from the same table the adapter queues into, so the painter
  // cannot play a band nothing fills, or miss one that something does.
  const strokeOrder = byBand(() =>
    root.createBuffer(arrayOf(u32, MAX_STROKE_DRAWS)).$usage("storage"),
  );
  const circleBuffer = root.createBuffer(arrayOf(CircleInst, MAX_CIRCLES)).$usage("storage");
  const circleOrder = byBand(() => root.createBuffer(arrayOf(u32, MAX_CIRCLES)).$usage("storage"));
  const pointBuffer = root.createBuffer(arrayOf(PointNode, MAX_POINTS)).$usage("storage");
  const pointOrder = byBand(() => root.createBuffer(arrayOf(u32, MAX_POINTS)).$usage("storage"));
  const fillBuffer = root.createBuffer(arrayOf(FillRegion, MAX_FILL_REGIONS)).$usage("storage");
  const fillOrderBuffer = root.createBuffer(arrayOf(u32, MAX_FILL_REGIONS)).$usage("storage");
  const fillSegBuffer = root.createBuffer(arrayOf(FillSeg, MAX_FILL_SEGS)).$usage("storage");
  const fillArcBuffer = root.createBuffer(arrayOf(FillArc, MAX_FILL_ARCS)).$usage("storage");
  /** Compiled CSG fields: one AABB quad per fill node plus its leaf/span windows. */
  const fieldQuadBuffer = root.createBuffer(arrayOf(FieldQuad, MAX_FIELD_QUADS)).$usage("storage");
  const fieldOrderBuffer = root.createBuffer(arrayOf(u32, MAX_FIELD_QUADS)).$usage("storage");
  const fieldLeafBuffer = root.createBuffer(arrayOf(FieldLeaf, MAX_FIELD_LEAVES)).$usage("storage");
  const fieldSegBuffer = root.createBuffer(arrayOf(FillSeg, MAX_FIELD_SEGS)).$usage("storage");
  const fieldArcBuffer = root.createBuffer(arrayOf(FillArc, MAX_FIELD_ARCS)).$usage("storage");

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
    .createBuffer(arrayOf(StrokeNode, MAX_STROKE_DRAWS))
    .$usage("storage");
  const overStrokesBuf = root.createBuffer(arrayOf(StrokeNode, MAX_STROKE_DRAWS)).$usage("storage");
  const underCirclesBuf = root.createBuffer(arrayOf(CircleInst, MAX_CIRCLES)).$usage("storage");
  const overCirclesBuf = root.createBuffer(arrayOf(CircleInst, MAX_CIRCLES)).$usage("storage");
  const overPointsBuf = root.createBuffer(arrayOf(PointNode, MAX_POINTS)).$usage("storage");
  const underFillsBuf = root.createBuffer(arrayOf(FillRegion, MAX_FILL_REGIONS)).$usage("storage");
  const overFillsBuf = root.createBuffer(arrayOf(FillRegion, MAX_FILL_REGIONS)).$usage("storage");
  const underEdgesBuf = root.createBuffer(arrayOf(FillSeg, MAX_FILL_SEGS)).$usage("storage");
  const underArcsBuf = root.createBuffer(arrayOf(FillArc, MAX_FILL_ARCS)).$usage("storage");
  const overEdgesBuf = root.createBuffer(arrayOf(FillSeg, MAX_FILL_SEGS)).$usage("storage");
  const overArcsBuf = root.createBuffer(arrayOf(FillArc, MAX_FILL_ARCS)).$usage("storage");
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
  const strokeGroups = byBand((band) =>
    root.createBindGroup(strokeLayout, {
      frame: frameBuffer,
      chrome: chromeBuffer,
      strokes: strokeBuffer,
      strokeOrder: strokeOrder[band],
    }),
  );
  const circleGroups = byBand((band) =>
    root.createBindGroup(circleLayout, {
      frame: frameBuffer,
      circles: circleBuffer,
      circleOrder: circleOrder[band],
    }),
  );
  const pointGroups = byBand((band) =>
    root.createBindGroup(diskLayout, {
      frame: frameBuffer,
      chrome: chromeBuffer,
      points: pointBuffer,
      pointOrder: pointOrder[band],
    }),
  );
  const fillGroup = root.createBindGroup(fillLayout, {
    frame: frameBuffer,
    fills: fillBuffer,
    fillOrder: fillOrderBuffer,
    fillSegs: fillSegBuffer,
    fillArcs: fillArcBuffer,
  });
  const fieldGroup = root.createBindGroup(fieldLayout, {
    frame: frameBuffer,
    fieldQuads: fieldQuadBuffer,
    fieldOrder: fieldOrderBuffer,
    fieldLeaves: fieldLeafBuffer,
    fieldSegs: fieldSegBuffer,
    fieldArcs: fieldArcBuffer,
  });
  const underStrokeGroup = root.createBindGroup(strokeLayout, {
    frame: frameBuffer,
    chrome: chromeBuffer,
    strokes: underStrokesBuf,
    strokeOrder: strokeOrderId,
  });
  const overStrokeGroup = root.createBindGroup(strokeLayout, {
    frame: frameBuffer,
    chrome: chromeBuffer,
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
    chrome: chromeBuffer,
    points: overPointsBuf,
    pointOrder: pointOrderId,
  });
  const underFillGroup = root.createBindGroup(fillLayout, {
    frame: frameBuffer,
    fills: underFillsBuf,
    fillOrder: fillOrderId,
    fillSegs: underEdgesBuf,
    fillArcs: underArcsBuf,
  });
  const overFillGroup = root.createBindGroup(fillLayout, {
    frame: frameBuffer,
    fills: overFillsBuf,
    fillOrder: fillOrderId,
    fillSegs: overEdgesBuf,
    fillArcs: overArcsBuf,
  });
  const markerGroup = root.createBindGroup(markerLayout, {
    frame: frameBuffer,
    marks: markerBuffer,
    markOrder: markerOrderId,
  });

  // One pipeline per (kind × band), each built for the band's layers: the base
  // layer and the instance count are baked into the shader, so a record never
  // has to say which layer it is. `byBand` walks the table, so every band the
  // adapter can queue into has a pipeline here.
  const strokeBands: Record<InkBandName, StrokePipelines> = byBand((band) =>
    createStrokePipelines(root, strokeGroups[band], opts.format, STROKE_BAND_LAYERS[band]!),
  );
  const circleBands: Record<InkBandName, CirclePipelines> = byBand((band) =>
    createCirclePipelines(root, circleGroups[band], opts.format),
  );
  const pointBands: Record<InkBandName, DiskPipelines> = byBand((band) =>
    createDiskPipelines(root, pointGroups[band], opts.format, POINT_BAND_LAYERS[band]!),
  );
  const fills: FillPipelines = createFillPipelines(root, fillGroup, opts.format);
  const grids: GridPipelines = createGridPipelines(root, gridGroup, opts.format, opts.gridColors);

  /** A band of one paint layer: what an overlay draw replays, since a ghost
   * carries its own colour and has no chrome of its own. */
  const PAINT_ONLY = [LAYER_PAINT];
  const underStrokes: StrokePipelines = createStrokePipelines(
    root,
    underStrokeGroup,
    opts.format,
    PAINT_ONLY,
  );
  const overStrokes: StrokePipelines = createStrokePipelines(
    root,
    overStrokeGroup,
    opts.format,
    PAINT_ONLY,
  );
  const underCircles: CirclePipelines = createCirclePipelines(root, underCircleGroup, opts.format);
  const overCircles: CirclePipelines = createCirclePipelines(root, overCircleGroup, opts.format);
  const overDisks: DiskPipelines = createDiskPipelines(
    root,
    overDiskGroup,
    opts.format,
    PAINT_ONLY,
  );
  const underFills: FillPipelines = createFillPipelines(root, underFillGroup, opts.format);
  const overFills: FillPipelines = createFillPipelines(root, overFillGroup, opts.format);
  const markers: MarkerPipelines = createMarkerPipelines(root, markerGroup, opts.format);
  // References draw first in the pass. Their textures load asynchronously and
  // ask for a frame when one arrives; until `draw` has seen a renderer there is
  // nothing to ask, and nothing has loaded yet either.
  let requestFrame: () => void = NO_FRAME;
  const images: ImageLayer = createImageLayer({
    root,
    format: opts.format,
    frameBuffer,
    onReady: () => requestFrame(),
  });
  let imageDraws: readonly ImageDraw[] = [];

  // Band sizes from the last applied patch (arrays are rewritten wholesale), one
  // per band per kind, plus the chrome the last patch carried.
  const strokeCounts: Record<InkBandName, number> = byBand(() => 0);
  const circleCounts: Record<InkBandName, number> = byBand(() => 0);
  const pointCounts: Record<InkBandName, number> = byBand(() => 0);
  let lastChrome: ChromeValue | undefined;
  let gridLines = 0;
  let axesVisible = false;
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
      writeRuns(strokeBuffer, patch.strokes.runs);
      for (const band of INK_BAND_ORDER) {
        strokeOrder[band].write(patch.strokes.bands[band]);
        strokeCounts[band] = patch.strokes.bands[band].length;
      }
      circleBuffer.writePartial(patch.circles.writes);
      for (const band of INK_BAND_ORDER) {
        circleOrder[band].write(patch.circles.bands[band]);
        circleCounts[band] = patch.circles.bands[band].length;
      }
      writeRuns(pointBuffer, patch.points.runs);
      for (const band of INK_BAND_ORDER) {
        pointOrder[band].write(patch.points.bands[band]);
        pointCounts[band] = patch.points.bands[band].length;
      }
      // The chrome is a handful of numbers a theme or a metric change moves, so
      // a camera move still writes `Frame` alone. The first patch always writes
      // it: nothing may draw before a band width has been stated.
      if (lastChrome === undefined || !sameChrome(lastChrome, patch.chrome)) {
        chromeBuffer.write(patch.chrome);
        lastChrome = patch.chrome;
      }
      writeRuns(fillBuffer, patch.fills.runs);
      fillOrderBuffer.write(patch.fills.order);
      writeRuns(fillSegBuffer, patch.fillSegs.runs);
      writeRuns(fillArcBuffer, patch.fillArcs.runs);
      writeRuns(fieldQuadBuffer, patch.fields.quads.runs);
      fieldOrderBuffer.write(patch.fields.quads.order);
      writeRuns(fieldLeafBuffer, patch.fields.leaves.runs);
      writeRuns(fieldSegBuffer, patch.fields.segs.runs);
      writeRuns(fieldArcBuffer, patch.fields.arcs.runs);
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
      const underSpans = spanWrites(ov.under.spans, MAX_FILL_SEGS, MAX_FILL_ARCS);
      underEdgesBuf.writePartial(underSpans.segs);
      underArcsBuf.writePartial(underSpans.arcs);
      underFillCount = Math.min(MAX_FILL_REGIONS, ov.under.fills.length);
      overStrokesBuf.writePartial(seqWrites(ov.over.strokes, MAX_STROKE_DRAWS));
      overStrokeCount = Math.min(MAX_STROKE_DRAWS, ov.over.strokes.length);
      overCirclesBuf.writePartial(seqWrites(ov.over.circles, MAX_CIRCLES));
      overCircleCount = Math.min(MAX_CIRCLES, ov.over.circles.length);
      overPointsBuf.writePartial(seqWrites(ov.over.disks, MAX_POINTS));
      overDiskCount = Math.min(MAX_POINTS, ov.over.disks.length);
      overFillsBuf.writePartial(seqWrites(ov.over.fills, MAX_FILL_REGIONS));
      const overSpans = spanWrites(ov.over.spans, MAX_FILL_SEGS, MAX_FILL_ARCS);
      overEdgesBuf.writePartial(overSpans.segs);
      overArcsBuf.writePartial(overSpans.arcs);
      overFillCount = Math.min(MAX_FILL_REGIONS, ov.over.fills.length);
      markerBuffer.writePartial(seqWrites(ov.over.markers, MAX_MARKERS));
      markerCount = Math.min(MAX_MARKERS, ov.over.markers.length);
      images.sync(patch.images.writes, patch.images.draws);
      imageDraws = patch.images.draws;
    },
    draw(renderer, resolveOverride, drawText) {
      requestFrame = renderer.requestFrame;
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
      // References are the paper's own furniture: under the grid, the fills,
      // the strokes and the points, so a sketch reads on top of a photograph.
      if (imageDraws.length > 0) images.draw(pass);
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
      // draw per layer (halo chrome under its own paint) and a compiled field
      // and a span fill are different pipelines — which keeps translucent
      // overlap compositing in SVG order.
      for (const draw of fillDraws) {
        if (draw.count === 0) continue;
        const halo = draw.layer === "halo";
        if (draw.path === "spans") {
          const pipeline = halo ? fills.halos(pass) : fills.fills(pass);
          pipeline.draw(FILL_QUAD_VERTICES, draw.count, 0, draw.first);
        } else {
          fieldPipeline(root, fieldGroup, draw.plan, opts.format, MSAA_SAMPLES, draw.layer)
            .with(pass)
            .draw(FIELD_QUAD_VERTICES, draw.count, 0, draw.first);
        }
      }
      // Ink chrome bands, back-to-front per SVG pass order: every edge's paint
      // (rest), hover halos, hover paints, lifted halos, lifted paints —
      // strokes before circles within each band — so a selected edge's chrome
      // stacks above a hovered circle's paint, and points stay topmost. Each
      // band's instance count is its entry count times the layers one entry
      // draws, both from the same table the adapter queued into.
      for (const band of INK_BAND_ORDER) {
        const strokeCount = strokeCounts[band];
        if (strokeCount > 0) {
          const p = strokeBands[band].strokes(pass);
          p.drawIndexed(
            strokeBands[band].indexCount,
            strokeCount * instancesPerEntry("strokes", band),
          );
        }
        const circleCount = circleCounts[band];
        if (circleCount > 0) {
          circleBands[band].circles(pass).draw(CIRCLE_VERTEX_COUNT, circleCount);
        }
      }
      // Points/gliders land topmost (render model: fills → ink → points), in the
      // same pass order within the mark.
      for (const band of INK_BAND_ORDER) {
        const markCount = pointCounts[band];
        if (markCount > 0) {
          pointBands[band]
            .points(pass)
            .draw(DISK_VERTEX_COUNT, markCount * instancesPerEntry("points", band));
        }
      }
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
      // Labels last: they are annotation on top of every world band, and this
      // keeps them in the same pass (one MSAA resolve, one submit).
      drawText?.(pass);
      pass.end();
      renderer.root.device.queue.submit([encoder.finish()]);
    },
    destroy() {
      for (const band of INK_BAND_ORDER) strokeBands[band].destroy();
      underStrokes.destroy();
      underStrokes.destroy();
      overStrokes.destroy();
      fills.destroy();
      grids.destroy();
      frameBuffer.destroy();
      chromeBuffer.destroy();
      strokeBuffer.destroy();
      for (const band of INK_BAND_ORDER) {
        strokeOrder[band].destroy();
        circleOrder[band].destroy();
        pointOrder[band].destroy();
      }
      circleBuffer.destroy();
      pointBuffer.destroy();
      fillBuffer.destroy();
      fillOrderBuffer.destroy();
      fillSegBuffer.destroy();
      fillArcBuffer.destroy();
      fieldQuadBuffer.destroy();
      fieldOrderBuffer.destroy();
      fieldLeafBuffer.destroy();
      fieldSegBuffer.destroy();
      fieldArcBuffer.destroy();
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
      underArcsBuf.destroy();
      overEdgesBuf.destroy();
      overArcsBuf.destroy();
      markerBuffer.destroy();
      markerOrderId.destroy();
      gridSpanBuffer.destroy();
      images.destroy();
    },
  };
}

/** One entry per band, keyed by `bands.ts`'s order. Anything a band needs — an
 * order buffer, a bind group, a pipeline, a count — is built through this, so a
 * band the table gains cannot be missing one of them here. */
function byBand<T>(make: (band: InkBandName) => T): Record<InkBandName, T> {
  return Object.fromEntries(INK_BAND_ORDER.map((band) => [band, make(band)])) as Record<
    InkBandName,
    T
  >;
}

/**
 * What the chrome uniform holds before any tick has said what the theme is.
 *
 * Every width is zero, so a band drawn from this state draws nothing at all:
 * the view applies a patch before it asks for the first frame, and a frame
 * without one has no world to draw either. The first patch always overwrites
 * this (`applyPatch` compares against `undefined`, not against these numbers).
 */
function blankChrome(): ChromeValue {
  return Chrome({
    haloHalfPx: 0,
    knockHalfPx: 0,
    pointRingAddPx: 0,
    pointKnockAddPx: 0,
    pointOutlineAddPx: 0,
    hoverAlpha: 0,
    selectAlpha: 1,
    mutedAlpha: 1,
    ink: vec3f(0, 0, 0),
    accent: vec3f(0, 0, 0),
    selectedPaint: vec3f(0, 0, 0),
    ring: vec3f(0, 0, 0),
    paper: vec3f(0, 0, 0),
  });
}

function sameRgb(a: v3f, b: v3f): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

/** Whether the chrome uniform has to be rewritten. Deliberately explicit rather
 * than a serialized key: this runs once a tick, and a camera move should not
 * allocate to discover that nothing about the theme changed. */
function sameChrome(a: ChromeValue, b: ChromeValue): boolean {
  return (
    a.haloHalfPx === b.haloHalfPx &&
    a.knockHalfPx === b.knockHalfPx &&
    a.pointRingAddPx === b.pointRingAddPx &&
    a.pointKnockAddPx === b.pointKnockAddPx &&
    a.pointOutlineAddPx === b.pointOutlineAddPx &&
    a.hoverAlpha === b.hoverAlpha &&
    a.selectAlpha === b.selectAlpha &&
    a.mutedAlpha === b.mutedAlpha &&
    sameRgb(a.ink, b.ink) &&
    sameRgb(a.accent, b.accent) &&
    sameRgb(a.selectedPaint, b.selectedPaint) &&
    sameRgb(a.ring, b.ring) &&
    sameRgb(a.paper, b.paper)
  );
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
