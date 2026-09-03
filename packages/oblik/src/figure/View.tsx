import { Show, createEffect, createMemo, createSignal } from "solid-js";
import IconFrame from "~icons/lucide/frame";
import IconMove from "~icons/lucide/move";
import IconScaling from "~icons/lucide/scaling";

import type { TraceNode } from "@/eval/context";
import { paintStrokesFromTrace, type FigureStyle, type PaintStroke } from "@/eval/paint";
import { reusePaintStrokes } from "@/eval/reuse-trace";
import { isFillGeom } from "@/geom/csg2";
import { isGlider } from "@/geom/gliders";

import {
  kWorldToNdc,
  screenToWorld,
  viewBox,
  wheelZoomFactor,
  zoomAt,
  type Camera2,
  type PaneSize,
} from "../euclid2/camera";
import { PICK_CLICK_PX, traceKey } from "../euclid2/pick";
import { mutedForScope, type Scope } from "../euclid2/tool";
import { ChromeBand } from "../euclid2/view/ChromeBand";
import { createDragHandler } from "../euclid2/view/createDragHandler";
import { chromeSplitEqual, sameList, splitChrome, type ChromeSplit } from "../euclid2/view/marks";
import { applyDrag, panDrag, topHit } from "../euclid2/view/pointer";
import { lookFromBrush, type BrushSettings } from "./chips";
import {
  frameRect,
  frameMoved,
  frameResized,
  pageScreenRect,
  type FigureFrame,
  type FrameRect,
  type FrameXywh,
} from "./frame";
import { FigurePoint, FigureStroke } from "./Ink";
import { brushAddHits, inkFromGeomHits, isDrawnGeom } from "./pick";
import type { FigureToolId } from "./tools";

import styles from "./View.module.css";

const DEFAULT_CAMERA: Camera2 = { x: 0, y: 0, scale: 48 };
const ONION: FigureStyle = { kind: "style", stroke: "#8a8478", width: 1.05 };

export type FigureViewProps = {
  trace: TraceNode[];
  initialCamera?: Camera2;
  paper?: "cream" | "white";
  frame?: FigureFrame;
  tool?: FigureToolId | null;
  shift?: boolean;
  brush: BrushSettings;
  hoverKey?: string | null;
  selectedKey?: string | null;
  frameSelected?: boolean;
  onFrameDraft?: (next: FrameXywh) => void;
  onFrameCommit?: (next: FrameXywh) => void;
  scope?: Scope;
  onShift?: (on: boolean) => void;
  onHoverKey?: (key: string | null) => void;
  onPick?: (hits: TraceNode[]) => void;
  onToolHit?: (node: TraceNode) => void;
  onPickFrame?: () => void;
};

function readPaneSize(el: Element): PaneSize | null {
  const r = el.getBoundingClientRect();
  if (r.width < 8 || r.height < 8) return null;
  return { w: r.width, h: r.height };
}

function panePoint(e: PointerEvent, el: HTMLDivElement): { x: number; y: number } {
  const rect = el.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function paintStrokeKey(s: PaintStroke): string {
  return `${traceKey(s.paint)}:${traceKey(s.geom)}`;
}

function isPointish(n: TraceNode): boolean {
  return n.value.kind === "point" || isGlider(n.value);
}

export function FigureView(props: FigureViewProps) {
  const [paneEl, setPaneEl] = createSignal<HTMLDivElement | null>(null);
  const initialCameraMemo = createMemo(() => props.initialCamera, {
    equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  });
  const [camera, setCamera] = createSignal<Camera2>(() => initialCameraMemo() ?? DEFAULT_CAMERA);
  const [size, setSize] = createSignal<PaneSize>({ w: 800, h: 600 });
  const [previewGeom, setPreviewGeom] = createSignal<TraceNode | null>(null);

  createEffect(
    () => paneEl(),
    (el) => {
      if (!el) return;
      const ro = new ResizeObserver(() => {
        const next = readPaneSize(el);
        if (next) setSize(next);
      });
      ro.observe(el);
      return () => ro.disconnect();
    },
  );

  const vb = createMemo(() => viewBox(size()));
  const worldXf = createMemo(() => {
    const cam = camera();
    const k = kWorldToNdc(cam, size());
    return `scale(${k} ${-k}) translate(${-cam.x} ${-cam.y})`;
  });
  const page = createMemo(() => frameRect(props.frame, initialCameraMemo()));
  const pageBox = createMemo(() => {
    const r = page();
    return r ? pageScreenRect(r, camera(), size()) : null;
  });
  const geom = createMemo(() => props.trace.filter(isDrawnGeom), { equals: sameList });
  const strokes = createMemo(
    (prev: PaintStroke[] | undefined) => reusePaintStrokes(prev, paintStrokesFromTrace(props.trace)),
    { equals: sameList },
  );
  const onionInk = createMemo(() => geom().filter((n) => !isPointish(n)), { equals: sameList });
  const onionFills = createMemo(
    () => onionInk().filter((n) => isFillGeom(n.value)),
    { equals: sameList },
  );
  const onionEdges = createMemo(
    () => onionInk().filter((n) => !isFillGeom(n.value)),
    { equals: sameList },
  );
  const onionPts = createMemo(() => geom().filter(isPointish), { equals: sameList });
  const inkStrokes = createMemo(
    () => strokes().filter((s) => !isPointish(s.geom)),
    { equals: sameList },
  );
  const inkFills = createMemo(
    () => inkStrokes().filter((s) => isFillGeom(s.geom.value)),
    { equals: sameList },
  );
  const inkEdges = createMemo(
    () => inkStrokes().filter((s) => !isFillGeom(s.geom.value)),
    { equals: sameList },
  );
  const inkPts = createMemo(
    () => strokes().filter((s) => isPointish(s.geom)),
    { equals: sameList },
  );
  const paintSelected = (s: PaintStroke) => traceKey(s.paint) === props.selectedKey;
  const geomSelected = (n: TraceNode) => traceKey(n) === props.selectedKey;
  const paintHover = (s: PaintStroke) => traceKey(s.paint) === props.hoverKey && !paintSelected(s);
  const geomHover = (n: TraceNode) => traceKey(n) === props.hoverKey && !geomSelected(n);
  const inkFillBand = createMemo(() => splitChrome(inkFills(), paintSelected, paintHover), {
    equals: chromeSplitEqual,
  });
  const inkEdgeBand = createMemo(() => splitChrome(inkEdges(), paintSelected, paintHover), {
    equals: chromeSplitEqual,
  });
  const inkPtBand = createMemo(() => splitChrome(inkPts(), paintSelected, paintHover), {
    equals: chromeSplitEqual,
  });
  const onionFillBand = createMemo(() => splitChrome(onionFills(), geomSelected, geomHover), {
    equals: chromeSplitEqual,
  });
  const onionEdgeBand = createMemo(() => splitChrome(onionEdges(), geomSelected, geomHover), {
    equals: chromeSplitEqual,
  });
  const onionPtBand = createMemo(() => splitChrome(onionPts(), geomSelected, geomHover), {
    equals: chromeSplitEqual,
  });
  const frameXywh = createMemo<FrameXywh | null>(() => {
    const r = page();
    if (!r) return null;
    return { x: r.x, y: r.y, width: r.w, height: r.h };
  });

  function worldAt(e: PointerEvent, el: HTMLDivElement): { x: number; y: number } {
    return screenToWorld(panePoint(e, el), camera(), size());
  }

  const drag = createDragHandler({ deadZoneRadius: PICK_CLICK_PX, preventDefault: false });

  const startPan = drag.start((e, hits: TraceNode[]) => {
    const start = panDrag(e, camera());
    const pick = hits.length > 0 ? hits : null;
    let moved = false;
    return {
      onPointerMove(ev) {
        moved = true;
        const next = applyDrag(start, ev, paneEl(), camera(), size(), props.trace);
        if (next.camera) setCamera(next.camera);
      },
      onDone() {
        if (!moved) props.onPick?.(pick ?? []);
      },
    };
  });

  const onFrameMove = drag.start(
    (e) => {
      const el = paneEl();
      const start = frameXywh();
      if (!el || !start) return;
      const world0 = worldAt(e, el);
      let last = start;
      return {
        onPointerMove(ev) {
          last = frameMoved(start, world0, worldAt(ev, el));
          props.onFrameDraft?.(last);
        },
        onDone() {
          props.onFrameCommit?.(last);
        },
      };
    },
    { preventDefault: true },
  );

  const onFrameResize = drag.start(
    (_e) => {
      const el = paneEl();
      const start = frameXywh();
      if (!el || !start) return;
      const anchor = { x: start.x, y: start.y };
      let last = start;
      return {
        onPointerMove(ev) {
          last = frameResized(anchor, worldAt(ev, el));
          props.onFrameDraft?.(last);
        },
        onDone() {
          props.onFrameCommit?.(last);
        },
      };
    },
    { preventDefault: true },
  );

  function onPointerDown(e: PointerEvent) {
    noteShift(e);
    if (e.button !== 0) return;
    const el = paneEl();
    if (!el) return;
    const hits = hitsOf(e, el);
    if (props.tool) {
      const hit = hits[0];
      if (hit) props.onToolHit?.(hit);
      return;
    }
    startPan(e, hits);
  }

  const previewKey = createMemo(() => {
    if (props.tool !== "brush") return null;
    const n = previewGeom();
    return n ? traceKey(n) : null;
  });

  function hitsOf(e: PointerEvent, el: HTMLDivElement): TraceNode[] {
    const geoms = topHit(e, el, camera(), size(), props.trace).filter(isDrawnGeom);
    if (props.shift) {
      if (props.tool === "brush") return brushAddHits(geoms, props.scope);
      return geoms;
    }
    return inkFromGeomHits(props.trace, geoms);
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    const el = paneEl();
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pane: PaneSize = { w: rect.width, h: rect.height };
    if (pane.w < 8 || pane.h < 8) return;
    const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    setCamera(zoomAt(camera(), screen, pane, wheelZoomFactor(e.deltaY, e.deltaMode)));
  }

  function noteShift(e: PointerEvent | KeyboardEvent) {
    props.onShift?.(e.shiftKey);
  }

  function noteHover(e: PointerEvent) {
    if (drag.phase() === "dragging") return;
    const el = paneEl();
    if (!el) return;
    const hits = hitsOf(e, el);
    const hit = hits[0] ?? null;
    props.onHoverKey?.(hit ? traceKey(hit) : null);
    if (props.tool === "brush" && props.shift && hit && isDrawnGeom(hit)) setPreviewGeom(hit);
    else if (props.tool === "brush" && !props.shift && hit?.value.kind === "paint") {
      const g = paintStrokesFromTrace(props.trace).find(
        (s) => s.paint === hit || traceKey(s.paint) === traceKey(hit),
      )?.geom;
      setPreviewGeom(g ?? null);
    } else setPreviewGeom(null);
  }

  function onPointerMove(e: PointerEvent) {
    noteShift(e);
    noteHover(e);
  }

  return (
    <div class={styles.mat}>
      <div
        ref={setPaneEl}
        class={[
          styles.paper,
          props.paper === "white" ? styles.white : styles.cream,
          {
            [styles.grabbing]: drag.phase() === "dragging",
            [styles.grab]: drag.phase() !== "dragging" && !props.tool,
            [styles.placing]: props.tool === "brush",
            [styles.erasing]: props.tool === "eraser",
          },
        ]}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerLeave={() => {
          props.onHoverKey?.(null);
          setPreviewGeom(null);
        }}
      >
        <Show when={pageBox()}>
          {(box) => (
            <div
              class={styles.page}
              aria-hidden="true"
              style={{
                left: `${box().left}px`,
                top: `${box().top}px`,
                width: `${box().width}px`,
                height: `${box().height}px`,
              }}
            />
          )}
        </Show>
        <Show when={pageBox()}>
          {(box) => (
            <button
              type="button"
              class={[
                styles.frameTitle,
                { [styles.frameTitleSelected]: props.frameSelected === true },
              ]}
              style={{
                left: `${box().left}px`,
                top: `${box().top}px`,
              }}
              onPointerDown={(e) => {
                e.stopPropagation();
                props.onPickFrame?.();
              }}
            >
              <IconFrame class={styles.frameIcon} aria-hidden="true" />
              Frame
            </button>
          )}
        </Show>
        <Show when={props.frameSelected === true && pageBox()}>
          {(box) => (
            <>
              <button
                type="button"
                class={[styles.frameHandle, styles.frameHandleMove]}
                style={{
                  left: `${box().left}px`,
                  top: `${box().top + box().height}px`,
                }}
                aria-label="Move frame"
                onPointerDown={onFrameMove}
              >
                <IconMove class={styles.frameHandleIcon} aria-hidden="true" />
              </button>
              <button
                type="button"
                class={[styles.frameHandle, styles.frameHandleResize]}
                style={{
                  left: `${box().left + box().width}px`,
                  top: `${box().top}px`,
                }}
                aria-label="Resize frame"
                onPointerDown={onFrameResize}
              >
                <IconScaling class={styles.frameHandleIcon} aria-hidden="true" />
              </button>
            </>
          )}
        </Show>
        <svg class={styles.world} viewBox={vb()}>
          <g transform={worldXf()}>
            <Show when={page()}>
              {(rect) => <FrameHandle rect={rect()} selected={props.frameSelected === true} />}
            </Show>
            <InkStrokeChrome
              band={inkFillBand()}
              hoverKey={props.hoverKey}
              selectedKey={props.selectedKey}
              eraser={props.tool === "eraser"}
              replacePreview={props.tool === "brush" && !props.shift}
              scope={props.scope}
              camera={camera()}
              size={size()}
              halos={drag.phase() !== "dragging"}
              ghosting={props.shift === true}
            />
            <InkStrokeChrome
              band={inkEdgeBand()}
              hoverKey={props.hoverKey}
              selectedKey={props.selectedKey}
              eraser={props.tool === "eraser"}
              replacePreview={props.tool === "brush" && !props.shift}
              scope={props.scope}
              camera={camera()}
              size={size()}
              halos={drag.phase() !== "dragging"}
              ghosting={props.shift === true}
            />
            <InkPointChrome
              band={inkPtBand()}
              hoverKey={props.hoverKey}
              selectedKey={props.selectedKey}
              eraser={props.tool === "eraser"}
              replacePreview={props.tool === "brush" && !props.shift}
              scope={props.scope}
              camera={camera()}
              halos={drag.phase() !== "dragging"}
              ghosting={props.shift === true}
            />
            <Show when={props.shift}>
              <OnionStrokeChrome
                band={onionFillBand()}
                hoverKey={props.hoverKey}
                selectedKey={props.selectedKey}
                scope={props.scope}
                camera={camera()}
                size={size()}
                previewKey={previewKey()}
                halos={drag.phase() !== "dragging"}
              />
              <OnionStrokeChrome
                band={onionEdgeBand()}
                hoverKey={props.hoverKey}
                selectedKey={props.selectedKey}
                scope={props.scope}
                camera={camera()}
                size={size()}
                previewKey={previewKey()}
                halos={drag.phase() !== "dragging"}
              />
              <OnionPointChrome
                band={onionPtBand()}
                hoverKey={props.hoverKey}
                selectedKey={props.selectedKey}
                scope={props.scope}
                camera={camera()}
                previewKey={previewKey()}
                halos={drag.phase() !== "dragging"}
              />
            </Show>
            <Show when={props.tool === "brush" ? previewGeom() : undefined} keyed>
              {(node) =>
                isPointish(node) ? (
                  <FigurePoint
                    node={node}
                    look={lookFromBrush(props.brush, node.value.kind)}
                    onion={false}
                    hot={false}
                    selected={false}
                    muted={false}
                    camera={camera()}
                    preview={true}
                  />
                ) : (
                  <FigureStroke
                    node={node}
                    look={lookFromBrush(props.brush, node.value.kind)}
                    onion={false}
                    hot={false}
                    selected={false}
                    muted={false}
                    camera={camera()}
                    size={size()}
                    preview={true}
                  />
                )
              }
            </Show>
          </g>
        </svg>
      </div>
    </div>
  );
}

function FrameHandle(props: { rect: FrameRect; selected: boolean }) {
  return (
    <Show when={props.selected}>
      <rect
        x={props.rect.x}
        y={props.rect.y}
        width={props.rect.w}
        height={props.rect.h}
        fill="none"
        stroke="var(--oblik-accent)"
        stroke-width={1.5}
        vector-effect="non-scaling-stroke"
        pointer-events="none"
      />
    </Show>
  );
}

function InkStrokeChrome(props: {
  band: ChromeSplit<PaintStroke>;
  hoverKey?: string | null;
  selectedKey?: string | null;
  eraser?: boolean;
  replacePreview?: boolean;
  scope?: Scope;
  camera: Camera2;
  size: PaneSize;
  halos?: boolean;
  ghosting?: boolean;
}) {
  return (
    <ChromeBand band={props.band} halos={props.halos} keyed={paintStrokeKey}>
      {(s, overlay) => (
        <InkStroke
          s={s()}
          hoverKey={props.hoverKey}
          selectedKey={props.selectedKey}
          eraser={props.eraser}
          replacePreview={props.replacePreview}
          scope={props.scope}
          camera={props.camera}
          size={props.size}
          overlay={overlay}
          ghosting={props.ghosting}
        />
      )}
    </ChromeBand>
  );
}

function InkPointChrome(props: {
  band: ChromeSplit<PaintStroke>;
  hoverKey?: string | null;
  selectedKey?: string | null;
  eraser?: boolean;
  replacePreview?: boolean;
  scope?: Scope;
  camera: Camera2;
  halos?: boolean;
  ghosting?: boolean;
}) {
  return (
    <ChromeBand band={props.band} halos={props.halos} keyed={paintStrokeKey}>
      {(s, overlay) => (
        <InkPoint
          s={s()}
          hoverKey={props.hoverKey}
          selectedKey={props.selectedKey}
          eraser={props.eraser}
          replacePreview={props.replacePreview}
          scope={props.scope}
          camera={props.camera}
          overlay={overlay}
          ghosting={props.ghosting}
        />
      )}
    </ChromeBand>
  );
}

function OnionStrokeChrome(props: {
  band: ChromeSplit<TraceNode>;
  hoverKey?: string | null;
  selectedKey?: string | null;
  scope?: Scope;
  camera: Camera2;
  size: PaneSize;
  previewKey: string | null;
  halos?: boolean;
}) {
  return (
    <ChromeBand band={props.band} halos={props.halos} keyed={traceKey}>
      {(n, overlay) => (
        <FigureStroke
          node={n()}
          look={ONION}
          onion={true}
          hot={traceKey(n()) === props.hoverKey || traceKey(n()) === props.selectedKey}
          selected={traceKey(n()) === props.selectedKey}
          muted={!!props.scope && mutedForScope(n(), props.scope)}
          camera={props.camera}
          size={props.size}
          replaced={props.previewKey === traceKey(n())}
          overlay={overlay}
        />
      )}
    </ChromeBand>
  );
}

function OnionPointChrome(props: {
  band: ChromeSplit<TraceNode>;
  hoverKey?: string | null;
  selectedKey?: string | null;
  scope?: Scope;
  camera: Camera2;
  previewKey: string | null;
  halos?: boolean;
}) {
  return (
    <ChromeBand band={props.band} halos={props.halos} keyed={traceKey}>
      {(n, overlay) => (
        <FigurePoint
          node={n()}
          look={undefined}
          onion={true}
          hot={traceKey(n()) === props.hoverKey || traceKey(n()) === props.selectedKey}
          selected={traceKey(n()) === props.selectedKey}
          muted={!!props.scope && mutedForScope(n(), props.scope)}
          camera={props.camera}
          replaced={props.previewKey === traceKey(n())}
          overlay={overlay}
        />
      )}
    </ChromeBand>
  );
}

function InkStroke(props: {
  s: PaintStroke;
  hoverKey?: string | null;
  selectedKey?: string | null;
  eraser?: boolean;
  replacePreview?: boolean;
  scope?: Scope;
  camera: Camera2;
  size: PaneSize;
  overlay?: boolean;
  ghosting?: boolean;
}) {
  const paintKeyNow = () => traceKey(props.s.paint);
  const geomMuted = () => !!props.scope && mutedForScope(props.s.geom, props.scope);
  const hot = () => paintKeyNow() === props.hoverKey || paintKeyNow() === props.selectedKey;
  const selected = () => paintKeyNow() === props.selectedKey;
  return (
    <FigureStroke
      node={props.s.geom}
      look={props.s.style}
      onion={false}
      hot={hot()}
      selected={selected()}
      muted={geomMuted() || props.ghosting === true}
      erase={props.eraser === true && paintKeyNow() === props.hoverKey}
      camera={props.camera}
      size={props.size}
      replaced={props.replacePreview === true && paintKeyNow() === props.hoverKey}
      overlay={props.overlay === true}
    />
  );
}

function InkPoint(props: {
  s: PaintStroke;
  hoverKey?: string | null;
  selectedKey?: string | null;
  eraser?: boolean;
  replacePreview?: boolean;
  scope?: Scope;
  camera: Camera2;
  overlay?: boolean;
  ghosting?: boolean;
}) {
  const paintKeyNow = () => traceKey(props.s.paint);
  const geomMuted = () => !!props.scope && mutedForScope(props.s.geom, props.scope);
  const hot = () => paintKeyNow() === props.hoverKey || paintKeyNow() === props.selectedKey;
  const selected = () => paintKeyNow() === props.selectedKey;
  return (
    <FigurePoint
      node={props.s.geom}
      look={props.s.style}
      onion={false}
      hot={hot()}
      selected={selected()}
      muted={geomMuted() || props.ghosting === true}
      erase={props.eraser === true && paintKeyNow() === props.hoverKey}
      camera={props.camera}
      replaced={props.replacePreview === true && paintKeyNow() === props.hoverKey}
      overlay={props.overlay === true}
    />
  );
}
