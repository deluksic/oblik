import type { Camera2, PaneSize } from "../../euclid2/camera";
import type { TgpuRoot } from "typegpu";
import { arrayOf } from "typegpu/data";

import type { Rgba } from "./renderer";
import { makeFrameValue } from "./frame";
import { buildGridDraws } from "./pipelines/grid";
import { createStrokePipelines, worldLayout, type StrokePipelines } from "./pipelines/strokes";
import { Frame, MAX_GRID_DRAWS, MAX_STROKE_DRAWS, StrokeDraw, type StrokeDrawValue } from "./schemas";

export type Painter = {
  /** Write the Frame uniform and rebuild grid hairlines for the new view state. */
  sync(cam: Camera2, size: PaneSize, dpr: number): void;
  /** Replace the world stroke instances (adapter output). */
  setStrokes(draws: readonly StrokeDrawValue[]): void;
  /** Record the clear + grid + stroke passes and submit. `resolveOverride`
   * redirects the MSAA resolve away from the swapchain (offscreen capture). */
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
  gridColors: { grid: [number, number, number]; axis: [number, number, number] };
}): Painter {
  const { root } = opts;

  const frameBuffer = root
    .createBuffer(Frame, makeFrameValue({ x: 0, y: 0, scale: 48 }, { w: 800, h: 600 }, 1))
    .$usage("uniform");
  const strokeBuffer = root.createBuffer(arrayOf(StrokeDraw, MAX_STROKE_DRAWS)).$usage("storage");
  const gridBuffer = root.createBuffer(arrayOf(StrokeDraw, MAX_GRID_DRAWS)).$usage("storage");
  const bindGroup = root.createBindGroup(worldLayout, {
    frame: frameBuffer,
    strokes: strokeBuffer,
    grid: gridBuffer,
  });
  const pipelines: StrokePipelines = createStrokePipelines(root, bindGroup, opts.format);

  let strokeCount = 0;
  let gridCount = 0;

  return {
    sync(cam, size, dpr) {
      frameBuffer.write(makeFrameValue(cam, size, dpr));
      const { draws, count } = buildGridDraws(cam, size, opts.gridColors, MAX_GRID_DRAWS);
      gridBuffer.writePartial(draws.map((value, idx) => ({ idx, value })));
      gridCount = count;
    },
    setStrokes(draws) {
      if (draws.length > MAX_STROKE_DRAWS) throw new Error("stroke draw overflow");
      strokeBuffer.writePartial(draws.map((value, idx) => ({ idx, value })));
      strokeCount = draws.length;
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
      const strokePass = pipelines.strokes(pass);
      strokePass.drawIndexed(pipelines.indexCount, strokeCount);
      pass.end();
      renderer.root.device.queue.submit([encoder.finish()]);
    },
    destroy() {
      pipelines.destroy();
      frameBuffer.destroy();
      strokeBuffer.destroy();
      gridBuffer.destroy();
    },
  };
}
