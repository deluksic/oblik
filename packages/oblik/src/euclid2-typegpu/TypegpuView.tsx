import { Show, createEffect, createMemo, createSignal, untrack } from "solid-js";

import type { TraceNode } from "#eval/context";

import {
  screenToWorld,
  wheelZoomFactor,
  zoomAt,
  type Camera2,
  type PaneSize,
} from "../euclid2/camera";
import { hitsNear, isFiniteTrace, movedPastClick, PICK_CLICK_PX } from "../euclid2/pick";
import { mutedForScope, toolChrome } from "../euclid2/tool";
import type { Ghost, PlaceHit, Scope, ToolSession } from "../euclid2/tool";
import { CONSTRUCTION_STROKE_PX } from "../euclid2/view/chrome";
import { createDragHandler, type DragSession } from "../euclid2/view/createDragHandler";
import { isGrabbable, hoverNode } from "../euclid2/view/marks";
import { applyDrag, editDragOf, panDrag, type EditDrag } from "../euclid2/view/pointer";
import { SliderDock } from "../euclid2/view/SliderDock";
import { sliderNodes } from "../euclid2/view/sliderHud";
import { resolveTheme, type ResolvedTheme } from "../host/theme";
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

/** Nodes the GPU pane draws (fills, ink, and point/glider marks); only drawn
 * nodes are pickable — you cannot select what is not rendered. Slider HUD
 * stays excluded. */
function isDrawnNode(n: TraceNode): boolean {
  return isFiniteTrace(n) && n.kind !== "slider";
}

/** True when the pointer event landed on the HTML slider dock, which owns its
 * own pointer/hover/drag interactions (the GPU view only routes around it). */
function isSliderHudTarget(e: { target: EventTarget | null }): boolean {
  const t = e.target;
  return t instanceof Element && t.closest("[data-slider-hud]") !== null;
}

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

/** Stable key for the colors the painter bakes in (paper clear + grid/axis
 * pipelines); only a changed key rebuilds them. */
function themeKey(paper: Rgba, grid: { grid: Rgb; axis: Rgb }): string {
  return [paper.r, paper.g, paper.b, paper.a, ...grid.grid, ...grid.axis].join(",");
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
  const sliders = createMemo(() => sliderNodes(props.trace));

  // Resolved theme (user override merged with the OS default, driven by Solid
  // signals — see host/theme.ts). Colors re-read whenever it changes.
  const resolvedTheme = createMemo(resolveTheme);
  /** Theme colors last applied to the painter (init snapshot or setTheme). */
  let lastThemeKey = "";

  let gpuRenderer: GpuRenderer | undefined;
  let world: Painter | undefined;
  let adapter: Adapter | undefined;
  /** Single drag state machine shared by pan and handle-edit sessions. */
  const drag = createDragHandler({ deadZoneRadius: PICK_CLICK_PX, preventDefault: false });

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
            draw: (r, resolveOverride) =>
              world ? world.draw(r, resolveOverride) : clearToPaper(r, paper),
          });
          (window as { __gpuCapture?: GpuRenderer["capture"] }).__gpuCapture = gpuRenderer.capture;
          world = createPainter({ root, format: gpuRenderer.format, paper, gridColors });
          lastThemeKey = themeKey(paper, gridColors);
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
      ResolvedTheme,
      string,
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
      resolvedTheme(),
      drag.phase(),
    ],
    ([cam, sz, el, , trace, hoverId, selectedKey, placing, toolSession, scope, , phase]) => {
      if (!gpuRenderer || !world || !adapter || !el) return;
      // Theme-derived colors the painter bakes in (paper clear + grid/axis
      // pipelines): swap them only when the resolved theme actually moves them.
      const paper = readPaperColor(el);
      const gridColors = {
        grid: readCssColor(el, "--oblik-grid"),
        axis: readCssColor(el, "--oblik-axis"),
      };
      const key = themeKey(paper, gridColors);
      if (key !== lastThemeKey) {
        lastThemeKey = key;
        world.setTheme(paper, gridColors);
      }
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
          ring: readCssColor(el, "--oblik-ring"),
          paper: readCssColor(el, "--oblik-paper"),
        },
        strokePx: CONSTRUCTION_STROKE_PX,
        hoverId,
        selectedKey,
        // Mirror the SVG view: while a drag is live the chrome paints lift but
        // their halo/knockout rings are suppressed.
        showHalos: phase !== "dragging",
        hideFills: chrome.hideFills ?? false,
        muted: (n) => chrome.muteStrokes === true || (!!scope && mutedForScope(n, scope)),
      });
      world.applyPatch(patch);
      setPatchStats({ written: patch.stats.written, total: patch.stats.total });
      gpuRenderer.requestFrame();
    },
  );

  /** CPU pick at the pointer (shared `pick.ts`, no DOM), restricted to nodes the
   * pane actually draws — see `isDrawnNode`. */
  function hitsAt(e: PointerEvent, el: HTMLDivElement): TraceNode[] {
    const cam = camera();
    const rect = el.getBoundingClientRect();
    const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    return hitsNear(props.trace, screenToWorld(screen, cam, size()), cam, size()).filter(
      isDrawnNode,
    );
  }

  // Mirrors the SVG view's pan gesture: a drag pans; releasing without having
  // panned is a click that picks the hits under the pointer ([] deselects).
  const startPan = drag.start(
    // oxlint-disable-next-line solid/reactivity -- drag.start factory runs at pointerdown; snapshot semantics are intentional.
    (e, hits: TraceNode[]) => {
      const initialStart = panDrag(e, camera());
      const pick = hits.length > 0 ? hits : undefined;
      let moved = false;
      return {
        onPointerMove(ev) {
          moved = true;
          const next = applyDrag(initialStart, ev, paperEl(), camera(), size(), props.trace);
          if (next.camera) setCamera(next.camera);
        },
        onDone() {
          if (!moved) props.onPick?.(pick ?? []);
        },
      };
    },
    { deadZoneRadius: 1 },
  );

  /** Grab-cursor while the hovered node is a draggable handle. */
  const grabbingHover = createMemo(() => isGrabbable(hoverNode(props.trace, props.hoverId)));

  // Handle editing (points, gliders, radii, parallels, offsets) — same session
  // semantics as the SVG view: live drafts during the drag, a literal commit on
  // release, and a sub-click release picks the node instead.
  function editSession(session: EditDrag, down: PointerEvent): DragSession {
    let live = false;
    return {
      onPointerMove(ev) {
        const next = applyDrag(session, ev, paperEl(), camera(), size(), props.trace);
        if (next.draft) {
          if (!live) {
            live = true;
            props.onLiveEdit?.(true);
          }
          props.onDraft(next.draft.id, next.draft.values);
        }
      },
      onDone(ev) {
        // Drop live-edit before commit so Solid batches one eval with stacks
        // and the final draft; the sidebar unfreezes on that same tick.
        if (live) props.onLiveEdit?.(false);
        if (!ev) return;
        // The 2px dead zone only absorbs jitter; travel past it still counts
        // toward the release-time click-vs-drag call: sub-click travel selects.
        if (!movedPastClick(down.clientX, down.clientY, ev.clientX, ev.clientY)) {
          props.onPick?.([session.node]);
          return;
        }
        const next = applyDrag(session, ev, paperEl(), camera(), size(), props.trace);
        if (next.draft) props.onCommit(next.draft.id, next.draft.values);
      },
    };
  }

  const startEdit = drag.start(
    // oxlint-disable-next-line solid/reactivity -- drag.start factory runs at pointerdown; snapshot semantics are intentional.
    (e, session: EditDrag) => editSession(session, e),
    { deadZoneRadius: 2 },
  );

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    const el = paperEl();
    if (!el) return;
    if (props.placing) return; // placement tools are a later cut (the SVG view also does not pan while placing).
    // The HTML slider dock handles its own drags (live draft → commit on
    // release, click picks); don't also start a pan here.
    if (isSliderHudTarget(e)) return;
    const hits = hitsAt(e, el);
    const hit = hits[0];
    if (hit && isGrabbable(hit)) {
      const session = editDragOf(e, el, hit, camera(), size());
      if (session) {
        startEdit(e, session);
        return;
      }
    }
    startPan(e, hits);
  }

  /** Hover lift: update while idle, never mid-drag; cleared on pointer leave.
   * The slider dock drives its own hover lift (panel highlights). */
  function onPointerMove(e: PointerEvent) {
    if (props.placing || drag.phase() === "dragging" || isSliderHudTarget(e)) return;
    const el = paperEl();
    if (!el) return;
    const hit = hitsAt(e, el)[0];
    props.onHoverId?.(hit?.id);
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
    <div
      ref={setPaperEl}
      class={[
        styles.paper,
        {
          [styles.grabbing]: drag.phase() === "dragging",
          [styles.grab]: grabbingHover() && drag.phase() !== "dragging" && !props.placing,
        },
      ]}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerLeave={() => props.onHoverId?.(undefined)}
      onWheel={onWheel}
    >
      <canvas ref={setCanvasEl} class={styles.canvas} />
      <SliderDock
        nodes={sliders()}
        placing={props.placing}
        hotId={props.hoverId}
        selectedKey={props.selectedKey}
        onHoverId={props.onHoverId}
        onPick={props.onPick}
        onDraft={props.onDraft}
        onCommit={props.onCommit}
        onLiveEdit={props.onLiveEdit}
      />
      <Show when={gpu() === "unavailable"}>
        <div class={styles.fallback}>WebGPU unavailable</div>
      </Show>
      {props.evalStats ? (
        <div class={styles.evalstats}>
          {props.evalStats.ms.toFixed(1)}ms · {props.evalStats.built} built · {props.evalStats.hits}{" "}
          cached
          {patchStats() ? ` · ${patchStats()!.written}/${patchStats()!.total} gpu` : ""}
        </div>
      ) : undefined}
    </div>
  );
}
