import { Show, createEffect, createSignal, untrack } from "solid-js";

import type { TraceNode } from "#eval/context";

import { wheelZoomFactor, zoomAt, type Camera2, type PaneSize } from "../euclid2/camera";
import { CONSTRUCTION_STROKE_PX } from "../euclid2/view/chrome";
import { mutedForScope, toolChrome } from "../euclid2/tool";
import { applyDrag, panDrag } from "../euclid2/view/pointer";
import { createDragHandler } from "../euclid2/view/createDragHandler";
import type { Ghost, PlaceHit, Scope, ToolSession } from "../euclid2/tool";
import { createAdapter, type Adapter, type Rgb } from "./gpu/adapter";
import { createPainter, type Painter } from "./gpu/painter";
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

// -- CSS color parsing (string in, floats out; no canvas probes) -------------

/** Browser color parser: assigning a bogus value keeps the previous value,
 * so every probe clears first — an empty serialization means "rejected". */
const colorProbe = document.createElement("option").style;

function srgbEncode(c: number): number {
  const x = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.min(1, Math.max(0, x));
}

/** OKLab → linear sRGB (Björn Ottosson's matrices). */
function oklabToLinear(l: number, a: number, b: number): [number, number, number] {
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;
  const L = l_ ** 3;
  const M = m_ ** 3;
  const S = s_ ** 3;
  return [
    4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
    -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
    -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S,
  ];
}

/** Components of a functional color: `rgb(1 0 0 / 50%)` → numbers + % flags. */
function colorParts(s: string): { v: number[]; pct: boolean[] } {
  const inner = s.slice(s.indexOf("(") + 1, s.lastIndexOf(")"));
  const parts = inner.split(/[\s,/]+/).filter(Boolean);
  const v: number[] = [];
  const pct: boolean[] = [];
  for (const part of parts) {
    const isPct = part.endsWith("%");
    const n = Number.parseFloat(part);
    v.push(Number.isFinite(n) ? n : 0);
    pct.push(isPct);
  }
  return { v, pct };
}

/** #abc → #aabbcc expansion, then hex → byte. */
function hexByte(chunk: string): number {
  return Number.parseInt(chunk.length === 1 ? chunk + chunk : chunk, 16);
}

function parseColor(s: string): Rgba | undefined {
  const t = s.trim().toLowerCase();
  if (t.startsWith("#")) {
    const hex = t.slice(1);
    if (![3, 4, 6, 8].includes(hex.length)) return undefined;
    const step = hex.length > 4 ? 2 : 1;
    const ch: number[] = [];
    for (let i = 0; i < hex.length; i += step) {
      const d = hexByte(hex.slice(i, i + step));
      if (!Number.isFinite(d)) return undefined;
      ch.push(d / 255);
    }
    const [r = 0, g = 0, b = 0, a = 1] = ch;
    return { r, g, b, a };
  }
  const { v, pct } = colorParts(t);
  const at = (i: number) => (pct[i] ? v[i]! / 100 : v[i]!);
  const alpha = () => (v[3] === undefined ? 1 : at(3));
  if (t.startsWith("rgb")) {
    const chan = (i: number) => (pct[i] ? at(i) : v[i]! / 255);
    return { r: chan(0), g: chan(1), b: chan(2), a: alpha() };
  }
  if (t.startsWith("color(")) {
    return { r: at(1), g: at(2), b: at(3), a: alpha() };
  }
  if (t.startsWith("oklch")) {
    const lin = oklabToLinear(
      at(0),
      at(1) * Math.cos((at(2) * Math.PI) / 180),
      at(1) * Math.sin((at(2) * Math.PI) / 180),
    );
    return { r: srgbEncode(lin[0]), g: srgbEncode(lin[1]), b: srgbEncode(lin[2]), a: alpha() };
  }
  if (t.startsWith("oklab")) {
    const lin = oklabToLinear(at(0), at(1), at(2));
    return { r: srgbEncode(lin[0]), g: srgbEncode(lin[1]), b: srgbEncode(lin[2]), a: alpha() };
  }
  return undefined;
}

/** Sample a resolved color string into a GPU clear value. */
function readColor(value: string): Rgba {
  colorProbe.color = "";
  colorProbe.color = value;
  return parseColor(colorProbe.color) ?? { r: 0, g: 0, b: 0, a: 1 };
}

function readPaperColor(el: HTMLElement): Rgba {
  return readColor(getComputedStyle(el).backgroundColor);
}

/** Resolve a theme var (oklch etc.) to [r, g, b] floats. */
function readCssColor(el: HTMLElement, prop: string): Rgb {
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
  const [patchStats, setPatchStats] = createSignal<{ written: number; total: number } | undefined>(
    undefined,
  );

  let gpuRenderer: GpuRenderer | undefined;
  let world: Painter | undefined;
  let adapter: Adapter | undefined;

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
          adapter = createAdapter();
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
        adapter?.destroy();
        adapter = undefined;
        releaseRoot();
      };
    },
  );

  createEffect(
    (): [
      Camera2,
      PaneSize,
      HTMLDivElement | undefined,
      number,
      TraceNode[],
      string | undefined,
      string | undefined,
      boolean,
      ToolSession | undefined,
      Scope | undefined,
    ] => [
      camera(),
      size(),
      paperEl(),
      ready(),
      props.trace,
      props.hoverId,
      props.selectedKey,
      props.placing ?? false,
      props.toolSession,
      props.scope,
    ],
    ([cam, sz, el, , trace, hoverId, selectedKey, placing, toolSession, scope]) => {
      if (!gpuRenderer || !world || !adapter || !el) return;
      world.sync(cam, sz, window.devicePixelRatio || 1);
      const chrome = toolChrome(placing ? toolSession : undefined);
      const patch = adapter.tick({
        trace,
        cam,
        size: sz,
        colors: {
          ink: readCssColor(el, "--oblik-ink"),
          accent: readCssColor(el, "--oblik-accent"),
          selectedPaint: readCssColor(el, "--oblik-selected-paint"),
        },
        strokePx: CONSTRUCTION_STROKE_PX,
        hoverId,
        selectedKey,
        hideFills: chrome.hideFills ?? false,
        muted: (n) => chrome.muteStrokes === true || (!!scope && mutedForScope(n, scope)),
      });
      world.applyPatch(patch);
      setPatchStats({ written: patch.stats.written, total: patch.stats.total });
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
          {patchStats() ? ` · ${patchStats()!.written}/${patchStats()!.total} gpu` : ""}
        </div>
      ) : undefined}
    </div>
  );
}
