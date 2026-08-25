import { For, createEffect, createMemo, createSignal } from "solid-js";

import type { TraceNode } from "../../eval/context";
import { kWorldToNdc, viewBox, type Camera2, type PaneSize } from "../camera";
import { isFiniteTrace } from "../pick";
import { hoverTool, type Ghost, type PlaceHit, type ToolSession } from "../tool";
import { GhostMark } from "./Ghost";
import { Grid } from "./Grid";
import { Handle, PlaceSnap, PointMark } from "./Hud";
import { Stroke } from "./Ink";
import { isGrabbable, isHot, isSelected, hoverNode } from "./marks";
import {
  applyDrag,
  dragMoved,
  panDrag,
  placeFromEvent,
  parallelDrag,
  pointDrag,
  radiusDrag,
  topHit,
  worldOf,
  type Drag,
} from "./pointer";

import styles from "./View.module.css";

const DEFAULT_CAMERA: Camera2 = { x: 0, y: 0, scale: 48 };

export type Euclid2ViewProps = {
  trace: TraceNode[];
  initialCamera?: Camera2;
  placing?: boolean;
  ghost?: Ghost | null;
  place?: PlaceHit | null;
  toolSession?: ToolSession | null;
  hoverId?: string | null;
  selectedKey?: string | null;
  onHoverId?: (id: string | null) => void;
  onPick?: (hits: TraceNode[]) => void;
  onDraft: (id: string, values: number[]) => void;
  onCommit: (id: string, values: number[]) => void;
  onPlace?: (hit: PlaceHit) => void;
  onCursor?: (hit: PlaceHit | null) => void;
};

function readPaneSize(el: Element): PaneSize | null {
  const r = el.getBoundingClientRect();
  if (r.width < 8 || r.height < 8) return null;
  return { w: r.width, h: r.height };
}

export function Euclid2View(props: Euclid2ViewProps) {
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

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    const cam = camera();
    const factor = e.deltaY < 0 ? 1.08 : 1 / 1.08;
    setCamera({ ...cam, scale: Math.min(280, Math.max(8, cam.scale * factor)) });
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    const el = paneEl();
    if (!el) return;
    if (props.placing) {
      props.onPlace?.(placeFromEvent(e, el, camera(), size(), props.trace, props.toolSession));
      return;
    }
    const w = worldOf(e, el, camera(), size());
    const hits = topHit(e, el, camera(), size(), props.trace);
    const hit = hits[0];
    if (hit && isGrabbable(hit) && hit.value.kind === "point") {
      drag = pointDrag(hit, w, e);
      return;
    }
    if (hit && isGrabbable(hit) && hit.value.kind === "circle") {
      drag = radiusDrag(hit, w, e);
      return;
    }
    if (hit && isGrabbable(hit) && hit.value.kind === "parallelLine") {
      drag = parallelDrag(hit, w, e);
      return;
    }
    drag = panDrag(e, camera());
    pendingPick = hits.length > 0 ? hits : null;
  }

  function noteHover(e: PointerEvent) {
    if (props.placing || drag?.moved) return;
    const hit = topHit(e, paneEl(), camera(), size(), props.trace)[0];
    props.onHoverId?.(hit?.id ?? null);
  }

  function beginDrag(e: PointerEvent) {
    const el = paneEl();
    if (el && !el.hasPointerCapture(e.pointerId)) el.setPointerCapture(e.pointerId);
    if (!grabbing()) setGrabbing(true);
  }

  function onPointerMove(e: PointerEvent) {
    if (props.placing) {
      const hit = placeFromEvent(e, paneEl(), camera(), size(), props.trace, props.toolSession);
      props.onCursor?.(hit);
      const session = props.toolSession;
      props.onHoverId?.(session ? hoverTool(session, hit, props.trace) : null);
    } else noteHover(e);
    if (!drag) return;
    if (!drag.moved) {
      if (!dragMoved(drag, e)) return;
      drag.moved = true;
      beginDrag(e);
    }
    const next = applyDrag(drag, e, paneEl(), camera(), size());
    if (next.camera) setCamera(next.camera);
    if (next.draft) props.onDraft(next.draft.id, next.draft.values);
  }

  function endDrag(e: PointerEvent) {
    const d = drag;
    const pick = pendingPick;
    drag = null;
    pendingPick = null;
    setGrabbing(false);
    if (d?.kind === "pan") {
      if (!d.moved) props.onPick?.(pick ?? []);
      return;
    }
    if (!d) return;
    if (!d.moved) {
      props.onPick?.([d.node]);
      return;
    }
    const next = applyDrag(d, e, paneEl(), camera(), size());
    if (next.draft) props.onCommit(next.draft.id, next.draft.values);
  }

  const strokes = createMemo(() => props.trace.filter(isFiniteTrace));
  const ink = createMemo(() => strokes().filter((n) => n.kind !== "point"));
  const points = createMemo(() => strokes().filter((n) => n.kind === "point"));
  const handles = createMemo(() => strokes().filter((n) => n.editable && n.kind === "point"));
  const grabbingHover = createMemo(() => isGrabbable(hoverNode(props.trace, props.hoverId)));

  return (
    <div
      ref={setPaneEl}
      class={[
        styles.paper,
        {
          [styles.grabbing]: grabbing(),
          [styles.grab]: grabbingHover() && !grabbing() && !props.placing,
          [styles.placing]: !!props.placing,
        },
      ]}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerLeave={() => {
        props.onHoverId?.(null);
        props.onCursor?.(null);
      }}
    >
      <svg class={styles.world} viewBox={vb()}>
        <g transform={worldXf()}>
          <Grid camera={camera()} size={size()} />
          <For each={ink()}>
            {(n) => (
              <Stroke
                node={n}
                hot={isHot(n, props.hoverId, props.selectedKey)}
                selected={isSelected(n, props.selectedKey)}
                camera={camera()}
                size={size()}
              />
            )}
          </For>
          {props.ghost ? <GhostMark ghost={props.ghost} camera={camera()} size={size()} /> : null}
        </g>
      </svg>
      <svg class={styles.hud} viewBox={`0 0 ${size().w} ${size().h}`} preserveAspectRatio="none">
        <For each={points()}>
          {(n) => (
            <PointMark
              node={n}
              size={size()}
              camera={camera()}
              hot={isHot(n, props.hoverId, props.selectedKey)}
              selected={isSelected(n, props.selectedKey)}
            />
          )}
        </For>
        <For each={handles()}>
          {(n) => (
            <Handle
              node={n}
              size={size()}
              camera={camera()}
              hot={isHot(n, props.hoverId, props.selectedKey)}
              selected={isSelected(n, props.selectedKey)}
            />
          )}
        </For>
        {props.placing && props.place && props.place.point.kind !== "free" ? (
          <PlaceSnap point={props.place.point} camera={camera()} size={size()} />
        ) : null}
      </svg>
    </div>
  );
}
