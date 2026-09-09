import type { TgpuRoot } from "typegpu";

export type Rgba = { r: number; g: number; b: number; a: number };

export type GpuRenderer = {
  readonly root: TgpuRoot;
  readonly canvas: HTMLCanvasElement;
  /** Preferred canvas format, resolved once at creation. */
  readonly format: GPUTextureFormat;
  /** Backing-store size in device pixels. */
  readonly size: { width: number; height: number };
  /** Swapchain texture view for the current frame; re-fetched after resize. */
  swapchainView(): GPUTextureView;
  /** Schedule a redraw; the rAF loop coalesces requests until it fires. */
  requestFrame(): void;
  destroy(): void;
};

export function createRenderer(opts: {
  root: TgpuRoot;
  canvas: HTMLCanvasElement;
  /** Called on every rendered frame; may call requestFrame() to keep animating. */
  draw: (renderer: GpuRenderer) => void;
}): GpuRenderer {
  const { root, canvas } = opts;
  const maybeContext = canvas.getContext("webgpu");
  if (!maybeContext) throw new Error("WebGPU canvas context unavailable");
  const context: GPUCanvasContext = maybeContext;
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device: root.device, format, alphaMode: "opaque" });
  let currentTextureView: GPUTextureView | undefined;

  const size = { width: 1, height: 1 };
  const ro = new ResizeObserver(() => resize());
  const renderer: GpuRenderer = {
    root,
    canvas,
    format,
    size,
    swapchainView,
    requestFrame: () => {
      dirty = true;
    },
    destroy,
  };

  let dirty = true;
  let raf = 0;
  let destroyed = false;

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (width === size.width && height === size.height) return;
    size.width = width;
    size.height = height;
    canvas.width = width;
    canvas.height = height;
    currentTextureView = undefined;
    dirty = true;
  }

  /** Swapchain texture view for the current frame; re-fetched after resize. */
  function swapchainView(): GPUTextureView {
    currentTextureView ??= context.getCurrentTexture().createView();
    return currentTextureView;
  }

  function frame() {
    raf = requestAnimationFrame(frame);
    if (!dirty) return;
    dirty = false;
    opts.draw(renderer);
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    cancelAnimationFrame(raf);
    ro.disconnect();
  }

  ro.observe(canvas);
  resize();
  raf = requestAnimationFrame(frame);

  return renderer;
}

/** Clear-only draw, used until the first pipeline lands. */
export function clearToPaper(renderer: GpuRenderer, paper: Rgba): void {
  const encoder = renderer.root.device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [
      {
        view: renderer.swapchainView(),
        clearValue: paper,
        loadOp: "clear",
        storeOp: "store",
      },
    ],
  });
  pass.end();
  renderer.root.device.queue.submit([encoder.finish()]);
}
