import { For, createEffect, createMemo, createSignal } from "solid-js";

import type { TraceNode } from "@/eval/context";
import { paintsFromTrace, paintKey, type FigureStyle } from "@/eval/paint";
import { isGlider } from "@/geom/gliders";
import { kWorldToNdc, viewBox, wheelZoomFactor, zoomAt, type Camera2, type PaneSize } from "../euclid2/camera";
import { isFiniteTrace, traceKey } from "../euclid2/pick";
import { mutedForScope, type Scope } from "../euclid2/tool";
import { isHot, isSelected } from "../euclid2/view/marks";
import { applyDrag, dragMoved, panDrag, topHit, type Drag } from "../euclid2/view/pointer";
import { FigurePoint, FigureStroke } from "./Ink";
import { frameRect, type FigureFrame } from "./frame";

import styles from "./View.module.css";

const DEFAULT_CAMERA: Camera2 = { x: 0, y: 0, scale: 48 };
const ONION: FigureStyle = { kind: "style", stroke: "#8a8478", width: 1.05 };

export type FigureViewProps = {
  trace: TraceNode[];
  initialCamera?: Camera2;
  paper?: "cream" | "white";
  frame?: FigureFrame;
  placing?: boolean;
  hoverId?: string | null;
  selectedKey?: string | null;
  scope?: Scope;
  onHoverId?: (id: string | null) => void;
  onPick?: (hits: TraceNode[]) => void;
  onPaint?: (node: TraceNode) => void;
};

function readPaneSize(el: Element): PaneSize | null {
  const r = el.getBoundingClientRect();
  if (r.width < 8 || r.height < 8) return null;
  return { w: r.width, h: r.height };
}

function isDrawnGeom(n: TraceNode): boolean {
  if (!isFiniteTrace(n)) return false;
  const k = n.value.kind;
  return k !== "slider" && k !== "style" && k !== "paint";
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
  const looks = createMemo(() => paintsFromTrace(props.trace));
  const geom = createMemo(() => props.trace.filter(isDrawnGeom));
  const onion = createMemo(() => geom().filter((n) => !looks().has(paintKey(n.id, n.occ))));
  const painted = createMemo(() =>
    geom().filter((n) => looks().has(paintKey(n.id, n.occ))),
  );
  const onionInk = createMemo(() => onion().filter((n) => !isPointish(n)));
  const onionPts = createMemo(() => onion().filter(isPointish));
  const paintedInk = createMemo(() => painted().filter((n) => !isPointish(n)));
  const paintedPts = createMemo(() => painted().filter(isPointish));

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

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    const el = paneEl();
    if (!el) return;
    const hits = topHit(e, el, camera(), size(), props.trace).filter(isDrawnGeom);
    if (props.placing) {
      const hit = hits[0];
      if (hit) props.onPaint?.(hit);
      return;
    }
    drag = panDrag(e, camera());
    pendingPick = hits.length > 0 ? hits : null;
  }

  function noteHover(e: PointerEvent) {
    if (drag?.moved) return;
    const el = paneEl();
    if (!el) return;
    const hit = topHit(e, el, camera(), size(), props.trace).filter(isDrawnGeom)[0];
    props.onHoverId?.(hit?.id ?? null);
  }

  function onPointerMove(e: PointerEvent) {
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
    <div class={[styles.mat, { [styles.flush]: !props.frame }]}>
      <div
        ref={setPaneEl}
        class={[
          styles.paper,
          props.paper === "white" ? styles.white : styles.cream,
          {
            [styles.framed]: !!props.frame,
            [styles.grabbing]: grabbing(),
            [styles.grab]: !grabbing() && !props.placing,
            [styles.placing]: !!props.placing,
          },
        ]}
        style={
          props.frame
            ? { "--frame-w": String(props.frame.width), "--frame-h": String(props.frame.height) }
            : undefined
        }
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={() => props.onHoverId?.(null)}
      >
        <svg class={styles.world} viewBox={vb()}>
          <g transform={worldXf()}>
            {page() ? (
              <rect
                class={styles.page}
                x={page()!.x}
                y={page()!.y}
                width={page()!.w}
                height={page()!.h}
              />
            ) : null}
            <For each={onionInk()}>
              {(n) => (
                <FigureStroke
                  node={n}
                  look={ONION}
                  onion={true}
                  hot={isHot(n, props.hoverId, props.selectedKey)}
                  selected={isSelected(n, props.selectedKey)}
                  muted={!!props.scope && mutedForScope(n, props.scope)}
                  camera={camera()}
                  size={size()}
                />
              )}
            </For>
            <For each={paintedInk()}>
              {(n) => (
                <FigureStroke
                  node={n}
                  look={looks().get(paintKey(n.id, n.occ)) ?? ONION}
                  onion={false}
                  hot={isHot(n, props.hoverId, props.selectedKey)}
                  selected={isSelected(n, props.selectedKey)}
                  muted={!!props.scope && mutedForScope(n, props.scope)}
                  camera={camera()}
                  size={size()}
                />
              )}
            </For>
            <For each={onionPts()}>
              {(n) => (
                <FigurePoint
                  node={n}
                  look={undefined}
                  onion={true}
                  hot={isHot(n, props.hoverId, props.selectedKey)}
                  selected={isSelected(n, props.selectedKey)}
                  muted={!!props.scope && mutedForScope(n, props.scope)}
                  camera={camera()}
                />
              )}
            </For>
            <For each={paintedPts()}>
              {(n) => (
                <FigurePoint
                  node={n}
                  look={looks().get(paintKey(n.id, n.occ))}
                  onion={false}
                  hot={isHot(n, props.hoverId, props.selectedKey)}
                  selected={isSelected(n, props.selectedKey)}
                  muted={!!props.scope && mutedForScope(n, props.scope)}
                  camera={camera()}
                />
              )}
            </For>
          </g>
        </svg>
      </div>
    </div>
  );
}
