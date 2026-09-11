import type { TgpuRoot } from "typegpu";

import { boxFromEntry, boxFromRect, currentDpr } from "../../euclid2/view/elementBox";

export type Rgba = { r: number; g: number; b: number; a: number };

export type GpuRenderer = {
  readonly root: TgpuRoot;
  readonly canvas: HTMLCanvasElement;
  /** Preferred canvas format, resolved once at creation. */
  readonly format: GPUTextureFormat;
  /** Backing-store size in device pixels. */
  readonly size: { width: number; height: number };
  /** Swapchain texture view; fetched fresh per frame (the context rotates
   * textures after every present). */
  swapchainView(): GPUTextureView;
  /** 4× MSAA attachment matching the backing store; resolved into the swapchain. */
  msaaView(): GPUTextureView;
  /** Schedule a redraw; the rAF loop coalesces requests until it fires. */
  requestFrame(): void;
  /** Render one frame into an offscreen texture and read it back as RGBA8 rows
   * (no row padding). Works even where canvas-to-screenshot compositing fails
   * (headless SwiftShader). */
  capture(): Promise<{ width: number; height: number; bytes: Uint8Array }>;
  destroy(): void;
};

export function createRenderer(opts: {
  root: TgpuRoot;
  canvas: HTMLCanvasElement;
  /** Called on every rendered frame; may call requestFrame() to keep animating.
   * `resolveOverride` redirects the MSAA resolve away from the swapchain (capture). */
  draw: (renderer: GpuRenderer, resolveOverride?: GPUTextureView) => void;
}): GpuRenderer {
  const { root, canvas } = opts;
  const maybeContext = canvas.getContext("webgpu");
  if (!maybeContext) throw new Error("WebGPU canvas context unavailable");
  const context: GPUCanvasContext = maybeContext;
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device: root.device, format, alphaMode: "opaque" });
  root.device.addEventListener("uncapturederror", (e) => {
    console.error("WebGPU uncaptured error", e.error?.message);
  });
  let msaaTexture: GPUTexture | undefined;
  let currentMsaaView: GPUTextureView | undefined;

  const size = { width: 1, height: 1 };
  const ro = new ResizeObserver((entries) => resize(entries));
  const renderer: GpuRenderer = {
    root,
    canvas,
    format,
    size,
    swapchainView,
    msaaView: ensureMsaa,
    requestFrame: () => {
      dirty = true;
    },
    capture,
    destroy,
  };

  let dirty = true;
  let raf = 0;
  let destroyed = false;

  function resize(entries?: ResizeObserverEntry[]) {
    // The backing store wants the *physical* box; `elementBox` is the one place
    // that knows how to read one, fallback included.
    const entry = entries?.find((e) => e.target === canvas);
    const { physical } = entry
      ? boxFromEntry(entry, currentDpr())
      : boxFromRect(canvas, currentDpr());
    if (physical.w === size.width && physical.h === size.height) return;
    size.width = physical.w;
    size.height = physical.h;
    canvas.width = physical.w;
    canvas.height = physical.h;
    currentMsaaView = undefined;
    // Draw here and now: this runs before paint, so a synchronous draw lands on
    // time, where `dirty` would paint one frame at the old size.
    dirty = true;
    drawNow();
  }

  /** Swapchain texture view; fetched fresh each frame — the context rotates
   * textures after every present, so a cached view goes stale. */
  function swapchainView(): GPUTextureView {
    return context.getCurrentTexture().createView();
  }

  /** 4× MSAA attachment matching the backing store; resolved into the swapchain.
   * Superseded textures are left to GC — destroying them here trips
   * "destroyed texture used in a submit" while earlier frames are still pending. */
  function ensureMsaa(): GPUTextureView {
    if (currentMsaaView) return currentMsaaView;
    msaaTexture = root.device.createTexture({
      size: [size.width, size.height, 1],
      format,
      sampleCount: 4,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    currentMsaaView = msaaTexture.createView();
    return currentMsaaView;
  }

  function frame() {
    raf = requestAnimationFrame(frame);
    if (!dirty) return;
    drawNow();
  }

  /** Render this instant rather than at the next animation frame; safe from any
   * task, since the queue orders submissions. */
  function drawNow(resolveOverride?: GPUTextureView) {
    if (destroyed) return;
    dirty = false;
    opts.draw(renderer, resolveOverride);
  }

  async function capture(): Promise<{ width: number; height: number; bytes: Uint8Array }> {
    const { width, height } = size;
    const resolve = root.device.createTexture({
      size: [width, height, 1],
      format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    drawNow(resolve.createView());
    const bytesPerRow = Math.ceil((width * 4) / 256) * 256;
    const staging = root.device.createBuffer({
      size: bytesPerRow * height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const encoder = root.device.createCommandEncoder();
    encoder.copyTextureToBuffer({ texture: resolve }, { buffer: staging, bytesPerRow }, [
      width,
      height,
      1,
    ]);
    root.device.queue.submit([encoder.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    const mapped = new Uint8Array(staging.getMappedRange());
    const bytes = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      bytes.set(mapped.subarray(y * bytesPerRow, y * bytesPerRow + width * 4), y * width * 4);
    }
    staging.unmap();
    staging.destroy();
    resolve.destroy();
    return { width, height, bytes };
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    cancelAnimationFrame(raf);
    ro.disconnect();
    msaaTexture?.destroy();
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
