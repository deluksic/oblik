import type { Camera2, PaneSize } from "../../euclid2/camera";
import type { TgpuRoot } from "typegpu";
import { arrayOf, u32 } from "typegpu/data";

import type { Rgba } from "./renderer";
import { makeFrameValue } from "./frame";
import type { TickPatch } from "./adapter";
import { buildGridDraws } from "./pipelines/grid";
import { createCirclePipelines, CIRCLE_VERTEX_COUNT, type CirclePipelines } from "./pipelines/circles";
import { createFillPipelines, type FillPipelines } from "./pipelines/fills";
import { createStrokePipelines, type StrokePipelines } from "./pipelines/strokes";
import { worldLayout } from "./layout";
import {
  CircleInst,
  FillEdge,
  FillRegion,
  Frame,
  MAX_CIRCLES,
  MAX_FILL_EDGES,
  MAX_FILL_REGIONS,
  MAX_GRID_DRAWS,
  MAX_STROKE_DRAWS,
  StrokeDraw,
} from "./schemas";

export type Painter = {
  /** Write the Frame uniform and rebuild grid hairlines for the new view state. */
  sync(cam: Camera2, size: PaneSize, dpr: number): void;
  /** Apply an adapter patch: per-kind slot writes + wholesale order lists. */
  applyPatch(patch: TickPatch): void;
  /** Record the clear + fills + strokes + circles passes and submit.
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

export function createPainter(opts: {
  root: TgpuRoot;
  format: GPUTextureFormat;
  paper: Rgba;
  gridColors: { grid: readonly [number, number, number]; axis: readonly [number, number, number] };
}): Painter {
  const { root } = opts;

  const frameBuffer = root
    .createBuffer(Frame, makeFrameValue({ x: 0, y: 0, scale: 48 }, { w: 800, h: 600 }, 1))
    .$usage("uniform");
  const strokeBuffer = root.createBuffer(arrayOf(StrokeDraw, MAX_STROKE_DRAWS)).$usage("storage");
  const gridBuffer = root.createBuffer(arrayOf(StrokeDraw, MAX_GRID_DRAWS)).$usage("storage");
  const strokeOrderBuffer = root.createBuffer(arrayOf(u32, MAX_STROKE_DRAWS)).$usage("storage");
  const circleBuffer = root.createBuffer(arrayOf(CircleInst, MAX_CIRCLES)).$usage("storage");
  const circleOrderBuffer = root.createBuffer(arrayOf(u32, MAX_CIRCLES)).$usage("storage");
  const fillBuffer = root.createBuffer(arrayOf(FillRegion, MAX_FILL_REGIONS)).$usage("storage");
  const fillOrderBuffer = root.createBuffer(arrayOf(u32, MAX_FILL_REGIONS)).$usage("storage");
  const fillEdgeBuffer = root.createBuffer(arrayOf(FillEdge, MAX_FILL_EDGES)).$usage("storage");

  const bindGroup = root.createBindGroup(worldLayout, {
    frame: frameBuffer,
    strokes: strokeBuffer,
    grid: gridBuffer,
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

  let strokeCount = 0;
  let gridCount = 0;
  let circleCount = 0;
  let fillCount = 0;

  return {
    sync(cam, size, dpr) {
      frameBuffer.write(makeFrameValue(cam, size, dpr));
      const { draws, count } = buildGridDraws(cam, size, opts.gridColors, MAX_GRID_DRAWS);
      gridBuffer.writePartial(draws.map((value, idx) => ({ idx, value })));
      gridCount = count;
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
            clearValue: opts.paper,
            loadOp: "clear",
            storeOp: "store",
          },
        ],
      });
      const gridPass = pipelines.grid(pass);
      gridPass.drawIndexed(pipelines.indexCount, gridCount);
      if (fillCount > 0) fills.fills(pass).draw(fillCount);
      const strokePass = pipelines.strokes(pass);
      strokePass.drawIndexed(pipelines.indexCount, strokeCount);
      if (circleCount > 0) circles.circles(pass).draw(CIRCLE_VERTEX_COUNT, circleCount);
      pass.end();
      renderer.root.device.queue.submit([encoder.finish()]);
    },
    destroy() {
      pipelines.destroy();
      fills.destroy();
      frameBuffer.destroy();
      strokeBuffer.destroy();
      gridBuffer.destroy();
      strokeOrderBuffer.destroy();
      circleBuffer.destroy();
      circleOrderBuffer.destroy();
      fillBuffer.destroy();
      fillOrderBuffer.destroy();
      fillEdgeBuffer.destroy();
    },
  };
}
