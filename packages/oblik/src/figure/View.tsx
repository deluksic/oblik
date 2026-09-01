import { For, Show, createEffect, createMemo, createSignal } from "solid-js";

import type { TraceNode } from "@/eval/context";
import { paintStrokesFromTrace, type FigureStyle, type PaintStroke } from "@/eval/paint";
import { isGlider } from "@/geom/gliders";
import { kWorldToNdc, viewBox, wheelZoomFactor, zoomAt, type Camera2, type PaneSize } from "../euclid2/camera";
import { traceKey } from "../euclid2/pick";
import { mutedForScope, type Scope } from "../euclid2/tool";
import { applyDrag, dragMoved, panDrag, topHit, type Drag } from "../euclid2/view/pointer";
import { lookFromBrush, type BrushSettings } from "./chips";
import { FigurePoint, FigureStroke } from "./Ink";
import { frameRect, pageScreenRect, type FigureFrame, type FrameRect } from "./frame";
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
  const [grabbing, setGrabbing] = createSignal(false);
  const [previewGeom, setPreviewGeom] = createSignal<TraceNode | null>(null);
  let drag: Drag | null = null;
  let pendingPick: TraceNode[] | null = null;

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
  const geom = createMemo(() => props.trace.filter(isDrawnGeom));
  const strokes = createMemo(() => paintStrokesFromTrace(props.trace));
  const onionInk = createMemo(() => geom().filter((n) => !isPointish(n)));
  const onionPts = createMemo(() => geom().filter(isPointish));
  const inkStrokes = createMemo(() => strokes().filter((s) => !isPointish(s.geom)));
  const inkPts = createMemo(() => strokes().filter((s) => isPointish(s.geom)));
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

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    noteShift(e);
    const el = paneEl();
    if (!el) return;
    const hits = hitsOf(e, el);
    if (props.tool) {
      const hit = hits[0];
      if (hit) props.onToolHit?.(hit);
      return;
    }
    drag = panDrag(e, camera());
    pendingPick = hits.length > 0 ? hits : null;
  }

  function noteHover(e: PointerEvent) {
    if (drag?.moved) return;
    const el = paneEl();
    if (!el) return;
    const hits = hitsOf(e, el);
    const hit = hits[0] ?? null;
    props.onHoverKey?.(hit ? traceKey(hit) : null);
    if (props.tool === "brush" && props.shift && hit && isDrawnGeom(hit)) setPreviewGeom(hit);
    else if (props.tool === "brush" && !props.shift && hit?.value.kind === "paint") {
      const g = paintStrokesFromTrace(props.trace).find((s) => s.paint === hit || traceKey(s.paint) === traceKey(hit))?.geom;
      setPreviewGeom(g ?? null);
    } else setPreviewGeom(null);
  }

  function onPointerMove(e: PointerEvent) {
    noteShift(e);
    noteHover(e);
    if (!drag) return;
    if (!drag.moved) {
      if (!dragMoved(drag, e)) return;
      drag.moved = true;
      const el = paneEl();
      if (el && !el.hasPointerCapture(e.pointerId)) el.setPointerCapture(e.pointerId);
      if (!grabbing()) setGrabbing(true);
    }
    const next = applyDrag(drag, e, paneEl(), camera(), size(), props.trace);
    if (next.camera) setCamera(next.camera);
  }

  function endDrag() {
    const d = drag;
    const pick = pendingPick;
    drag = null;
    pendingPick = null;
    setGrabbing(false);
    if (d?.kind === "pan") {
      if (!d.moved) props.onPick?.(pick ?? []);
    }
  }

  return (
    <div class={styles.mat}>
      <div
        ref={setPaneEl}
        class={[
          styles.paper,
          props.paper === "white" ? styles.white : styles.cream,
          {
            [styles.grabbing]: grabbing(),
            [styles.grab]: !grabbing() && !props.tool,
            [styles.placing]: props.tool === "brush",
            [styles.erasing]: props.tool === "eraser",
          },
        ]}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
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
        <svg class={styles.world} viewBox={vb()}>
          <g transform={worldXf()}>
            <Show when={page()}>
              {(rect) => <FrameHandle rect={rect()} selected={props.frameSelected === true} onPick={props.onPickFrame} />}
            </Show>
            <Show when={props.shift}>
              <For each={onionInk()}>
                {(n) => (
                  <FigureStroke
                    node={n}
                    look={ONION}
                    onion={true}
                    hot={traceKey(n) === props.hoverKey || traceKey(n) === props.selectedKey}
                    selected={traceKey(n) === props.selectedKey}
                    muted={!!props.scope && mutedForScope(n, props.scope)}
                    camera={camera()}
                    size={size()}
                    replaced={previewKey() === traceKey(n)}
                  />
                )}
              </For>
            </Show>
            <For each={inkStrokes()}>
              {(s) => (
                <InkStroke
                  s={s}
                  hoverKey={props.hoverKey}
                  selectedKey={props.selectedKey}
                  eraser={props.tool === "eraser"}
                  replacePreview={props.tool === "brush" && !props.shift}
                  scope={props.scope}
                  camera={camera()}
                  size={size()}
                />
              )}
            </For>
            <Show when={props.shift}>
              <For each={onionPts()}>
                {(n) => (
                  <FigurePoint
                    node={n}
                    look={undefined}
                    onion={true}
                    hot={traceKey(n) === props.hoverKey || traceKey(n) === props.selectedKey}
                    selected={traceKey(n) === props.selectedKey}
                    muted={!!props.scope && mutedForScope(n, props.scope)}
                    camera={camera()}
                    replaced={previewKey() === traceKey(n)}
                  />
                )}
              </For>
            </Show>
            <For each={inkPts()}>
              {(s) => (
                <InkPoint
                  s={s}
                  hoverKey={props.hoverKey}
                  selectedKey={props.selectedKey}
                  eraser={props.tool === "eraser"}
                  replacePreview={props.tool === "brush" && !props.shift}
                  scope={props.scope}
                  camera={camera()}
                />
              )}
            </For>
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

function FrameHandle(props: { rect: FrameRect; selected: boolean; onPick?: () => void }) {
  return (
    <g>
      <rect
        x={props.rect.x}
        y={props.rect.y}
        width={props.rect.w}
        height={props.rect.h}
        fill="none"
        stroke="transparent"
        stroke-width={14}
        vector-effect="non-scaling-stroke"
        pointer-events="stroke"
        style={{ cursor: "pointer" }}
        onPointerDown={(e) => {
          e.stopPropagation();
          props.onPick?.();
        }}
      />
      <Show when={props.selected}>
        <rect
          x={props.rect.x}
          y={props.rect.y}
          width={props.rect.w}
          height={props.rect.h}
          fill="none"
          stroke="#c45c3e"
          stroke-width={1.5}
          vector-effect="non-scaling-stroke"
          pointer-events="none"
        />
      </Show>
    </g>
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
}) {
  const paintKeyNow = () => traceKey(props.s.paint);
  const geomMuted = () => !!props.scope && mutedForScope(props.s.geom, props.scope);
  return (
    <FigureStroke
      node={props.s.geom}
      look={props.s.style}
      onion={false}
      hot={paintKeyNow() === props.hoverKey || paintKeyNow() === props.selectedKey}
      selected={paintKeyNow() === props.selectedKey}
      muted={geomMuted() || (props.eraser === true && paintKeyNow() === props.hoverKey)}
      camera={props.camera}
      size={props.size}
      replaced={props.replacePreview === true && paintKeyNow() === props.hoverKey}
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
}) {
  const paintKeyNow = () => traceKey(props.s.paint);
  const geomMuted = () => !!props.scope && mutedForScope(props.s.geom, props.scope);
  return (
    <FigurePoint
      node={props.s.geom}
      look={props.s.style}
      onion={false}
      hot={paintKeyNow() === props.hoverKey || paintKeyNow() === props.selectedKey}
      selected={paintKeyNow() === props.selectedKey}
      muted={geomMuted() || (props.eraser === true && paintKeyNow() === props.hoverKey)}
      camera={props.camera}
      replaced={props.replacePreview === true && paintKeyNow() === props.hoverKey}
    />
  );
}
