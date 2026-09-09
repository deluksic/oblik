import { Show, createEffect, createSignal, untrack } from "solid-js";

import type { TraceNode } from "#eval/context";

import { wheelZoomFactor, zoomAt, type Camera2, type PaneSize } from "../euclid2/camera";
import { applyDrag, panDrag } from "../euclid2/view/pointer";
import { createDragHandler } from "../euclid2/view/createDragHandler";
import type { Ghost, PlaceHit, Scope, ToolSession } from "../euclid2/tool";
import { createPainter, type Painter } from "./gpu/painter";
import { buildPreviewDraws } from "./gpu/preview";
import { clearToPaper, createRenderer, type GpuRenderer, type Rgba } from "./gpu/renderer";
import { acquireRoot, hasWebGPU, releaseRoot } from "./gpu/root";

import styles from "./TypegpuView.module.css";

export type TypegpuViewProps = {
  trace: TraceNode[];
  initialCamera?: { x: number; y: number; scale: number };
  placing?: boolean;
  ghost?: Ghost | undefined;
  place?: PlaceHit | undefined;
  toolSession?: ToolSession | undefined;
  hoverId?: string | undefined;
  selectedKey?: string | undefined;
  onHoverId?: (id: string | undefined) => void;
  onPick?: (hits: TraceNode[]) => void;
  onDraft: (id: string, values: number[]) => void;
  onCommit: (id: string, values: number[]) => void;
  /** True while an edit drag has produced a draft; false on release/cancel. */
  onLiveEdit?: (live: boolean) => void;
  onPlace?: (hit: PlaceHit) => void;
  onCursor?: (hit: PlaceHit | undefined) => void;
  scope?: Scope;
  evalStats?: { ms: number; built: number; hits: number } | undefined;
};

type GpuState = "init" | "ok" | "unavailable";

const DEFAULT_CAMERA: Camera2 = { x: 0, y: 0, scale: 48 };

/** Sample a resolved color into a GPU clear value. */
function readColor(value: string): Rgba {
  const probe = document.createElement("canvas");
  probe.width = 1;
  probe.height = 1;
  const ctx = probe.getContext("2d");
  if (!ctx) return { r: 0, g: 0, b: 0, a: 1 };
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = value;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
  return { r: r / 255, g: g / 255, b: b / 255, a: a / 255 };
}

function readPaperColor(el: HTMLElement): Rgba {
  return readColor(getComputedStyle(el).backgroundColor);
}

/** Resolve a theme var (oklch etc.) to [r, g, b] floats. */
function readCssColor(el: HTMLElement, prop: string): [number, number, number] {
  const raw = getComputedStyle(el).getPropertyValue(prop).trim();
  const { r, g, b } = readColor(raw);
  return [r, g, b];
}

export function TypegpuView(props: TypegpuViewProps) {
  const [paperEl, setPaperEl] = createSignal<HTMLDivElement | undefined>(undefined);
  const [canvasEl, setCanvasEl] = createSignal<HTMLCanvasElement | undefined>(undefined);
  const [gpu, setGpu] = createSignal<GpuState>("init");
  const [camera, setCamera] = createSignal<Camera2>(
    untrack(() => props.initialCamera) ?? DEFAULT_CAMERA,
  );
  const [size, setSize] = createSignal<PaneSize>({ w: 800, h: 600 });
  // Bumped once the renderer+painter exist so reactive effects re-run.
  const [ready, setReady] = createSignal(0);

  let gpuRenderer: GpuRenderer | undefined;
  let world: Painter | undefined;

  createEffect(
    (): [HTMLDivElement | undefined, HTMLCanvasElement | undefined] => [paperEl(), canvasEl()],
    ([el, canvas]) => {
      if (!el || !canvas) return;
      if (!hasWebGPU()) {
        setGpu("unavailable");
        return;
      }
      let disposed = false;
      acquireRoot()
        // oxlint-disable-next-line solid/reactivity -- writes only inside the async continuation
        .then((root) => {
          if (disposed) {
            releaseRoot();
            return;
          }
          const paper = readPaperColor(el);
          const gridColors = {
            grid: readCssColor(el, "--oblik-grid"),
            axis: readCssColor(el, "--oblik-axis"),
          };
          gpuRenderer = createRenderer({
            root,
            canvas,
            draw: (r, resolveOverride) => (world ? world.draw(r, resolveOverride) : clearToPaper(r, paper)),
          });
          (window as { __gpuCapture?: GpuRenderer["capture"] }).__gpuCapture = gpuRenderer.capture;
          world = createPainter({ root, format: gpuRenderer.format, paper, gridColors });
          setGpu("ok");
          setReady(ready() + 1);
        })
        .catch((err) => {
          releaseRoot();
          if (!disposed) setGpu("unavailable");
          console.error("WebGPU init failed", err);
        });
      return () => {
        disposed = true;
        delete (window as { __gpuCapture?: GpuRenderer["capture"] }).__gpuCapture;
        gpuRenderer?.destroy();
        gpuRenderer = undefined;
        world?.destroy();
        world = undefined;
        releaseRoot();
      };
    },
  );

  createEffect(
    (): [Camera2, PaneSize, HTMLDivElement | undefined, number] => [
      camera(),
      size(),
      paperEl(),
      ready(),
    ],
    ([cam, sz, el]) => {
      if (!gpuRenderer || !world || !el) return;
      world.sync(cam, sz, window.devicePixelRatio || 1);
      world.setStrokes(buildPreviewDraws(readCssColor(el, "--oblik-ink"), cam.scale));
      gpuRenderer.requestFrame();
    },
  );

  const drag = createDragHandler({ deadZoneRadius: 1, preventDefault: false });

  const startPan = drag.start(
    // oxlint-disable-next-line solid/reactivity -- drag.start factory runs at pointerdown; snapshot semantics are intentional.
    (e) => {
      const initialStart = panDrag(e, camera());
      return {
        onPointerMove(ev) {
          const next = applyDrag(initialStart, ev, paperEl(), camera(), size(), props.trace);
          if (next.camera) setCamera(next.camera);
        },
        onDone() {},
      };
    },
    { deadZoneRadius: 1 },
  );

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    if (!paperEl()) return;
    startPan(e);
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    const el = paperEl();
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pane: PaneSize = { w: rect.width, h: rect.height };
    if (pane.w < 8 || pane.h < 8) return;
    const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    setCamera(zoomAt(camera(), screen, pane, wheelZoomFactor(e.deltaY, e.deltaMode)));
  }

  // Keep the size signal aligned with the paper box (the canvas is inside it).
  createEffect(
    (): HTMLDivElement | undefined => paperEl(),
    (el) => {
      if (!el) return;
      const ro = new ResizeObserver(() => {
        const rect = el.getBoundingClientRect();
        setSize({ w: rect.width, h: rect.height });
      });
      ro.observe(el);
      const rect = el.getBoundingClientRect();
      setSize({ w: rect.width, h: rect.height });
      return () => ro.disconnect();
    },
  );

  return (
    <div ref={setPaperEl} class={styles.paper} onPointerDown={onPointerDown} onWheel={onWheel}>
      <canvas ref={setCanvasEl} class={styles.canvas} />
      <Show when={gpu() === "unavailable"}>
        <div class={styles.fallback}>WebGPU unavailable</div>
      </Show>
      {props.evalStats ? (
        <div class={styles.evalstats}>
          {props.evalStats.ms.toFixed(1)}ms · {props.evalStats.built} built ·{" "}
          {props.evalStats.hits} cached
        </div>
      ) : undefined}
    </div>
  );
}
