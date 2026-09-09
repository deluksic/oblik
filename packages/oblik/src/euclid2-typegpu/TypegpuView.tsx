import { Show, createEffect, createSignal } from "solid-js";

import type { TraceNode } from "#eval/context";

import type { Ghost, PlaceHit, Scope, ToolSession } from "../euclid2/tool";
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

/** Sample the paper element's resolved background color into a GPU clear value. */
function readPaperColor(el: HTMLElement): Rgba {
  const probe = document.createElement("canvas");
  probe.width = 1;
  probe.height = 1;
  const ctx = probe.getContext("2d");
  if (!ctx) return { r: 0, g: 0, b: 0, a: 1 };
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = getComputedStyle(el).backgroundColor;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
  return { r: r / 255, g: g / 255, b: b / 255, a: a / 255 };
}

export function TypegpuView(props: TypegpuViewProps) {
  const [paperEl, setPaperEl] = createSignal<HTMLDivElement | undefined>(undefined);
  const [canvasEl, setCanvasEl] = createSignal<HTMLCanvasElement | undefined>(undefined);
  const [gpu, setGpu] = createSignal<GpuState>("init");

  createEffect(
    (): [HTMLDivElement | undefined, HTMLCanvasElement | undefined] => [paperEl(), canvasEl()],
    ([el, canvas]) => {
      if (!el || !canvas) return;
      if (!hasWebGPU()) {
        setGpu("unavailable");
        return;
      }
      let disposed = false;
      let renderer: GpuRenderer | undefined;
      acquireRoot()
        .then((root) => {
          if (disposed) {
            releaseRoot();
            return;
          }
          const paper = readPaperColor(el);
          renderer = createRenderer({
            root,
            canvas,
            draw: (r) => clearToPaper(r, paper),
          });
          setGpu("ok");
        })
        .catch((err) => {
          releaseRoot();
          if (!disposed) setGpu("unavailable");
          console.error("WebGPU init failed", err);
        });
      return () => {
        disposed = true;
        renderer?.destroy();
        releaseRoot();
      };
    },
  );

  return (
    <div ref={setPaperEl} class={styles.paper}>
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
