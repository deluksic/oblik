import { For, createEffect, createMemo, createSignal } from "solid-js";

import type { TraceNode } from "@/eval/context";
import { kWorldToNdc, viewBox, wheelZoomFactor, zoomAt, type Camera2, type PaneSize } from "../camera";
import { isFiniteTrace, PICK_CLICK_PX, traceKey } from "../pick";
import {
  hoverTool,
  mutedForScope,
  snapFilterOf,
  toolChrome,
  type Ghost,
  type PlaceHit,
  type Scope,
  type ToolSession,
} from "../tool";
import { profileEligibleCarriers } from "../tools/profile";
import { isGlider } from "@/geom/gliders";
import { isProfile } from "@/geom/profile";
import { GhostMark } from "./Ghost";
import { Grid } from "./Grid";
import { Handle, PlaceSnap, PointMark } from "./Hud";
import { NumberSliders } from "./NumberSliders";
import { ProfileFill, ProfileGhost, ProfileOutline, Stroke } from "./Ink";
import { isGrabbable, isHot, isSelected, hoverNode, liftSelected } from "./marks";
import { hitSlider, sliderNodes } from "./sliderHud";
import {
  applyDrag,
  editDragOf,
  panDrag,
  placeFromEvent,
  sliderDrag,
  topHit,
  type EditDrag,
} from "./pointer";
import { createDragHandler, type DragSession } from "./createDragHandler";

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
  scope?: Scope;
};

function readPaneSize(el: Element): PaneSize | null {
  const r = el.getBoundingClientRect();
  if (r.width < 8 || r.height < 8) return null;
  return { w: r.width, h: r.height };
}

function screenOf(e: PointerEvent, el: HTMLDivElement): { x: number; y: number } {
  const rect = el.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

export function Euclid2View(props: Euclid2ViewProps) {
  const [paneEl, setPaneEl] = createSignal<HTMLDivElement | null>(null);
  const initialCameraMemo = createMemo(() => props.initialCamera, {
    equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  });
  const [camera, setCamera] = createSignal<Camera2>(() => initialCameraMemo() ?? DEFAULT_CAMERA);
  const [size, setSize] = createSignal<PaneSize>({ w: 800, h: 600 });

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

  function placeAt(e: PointerEvent, el: HTMLDivElement) {
    const filter = props.scope ? snapFilterOf(props.scope) : undefined;
    const hit = placeFromEvent(e, el, camera(), size(), props.trace, props.toolSession, filter, props.scope);
    const nearest = topHit(e, el, camera(), size(), props.trace)[0];
    if (nearest && filter?.keys && !filter.keys.has(traceKey(nearest)) && hit.point.kind === "free") return;
    props.onPlace?.(hit);
  }

  const drag = createDragHandler({ deadZoneRadius: PICK_CLICK_PX, preventDefault: false });

  function editSession(session: EditDrag): DragSession {
    let moved = false;
    return {
      onPointerMove(ev) {
        moved = true;
        const next = applyDrag(session, ev, paneEl(), camera(), size(), props.trace);
        if (next.draft) props.onDraft(next.draft.id, next.draft.values);
      },
      onDone(ev) {
        if (!moved) {
          props.onPick?.([session.node]);
          return;
        }
        if (!ev) return;
        const next = applyDrag(session, ev, paneEl(), camera(), size(), props.trace);
        if (next.draft) props.onCommit(next.draft.id, next.draft.values);
      },
    };
  }

  const startEdit = drag.start((_e, session: EditDrag) => editSession(session));

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

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    const el = paneEl();
    if (!el) return;
    if (props.placing) {
      placeAt(e, el);
      return;
    }
    const slider = hitSlider(screenOf(e, el), sliderNodes(props.trace));
    if (slider) {
      startEdit(e, sliderDrag(slider, e));
      return;
    }
    const hits = topHit(e, el, camera(), size(), props.trace);
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

  function noteHover(e: PointerEvent) {
    if (props.placing || drag.phase() === "dragging") return;
    const el = paneEl();
    if (!el) return;
    const slider = hitSlider(screenOf(e, el), sliderNodes(props.trace));
    if (slider) {
      props.onHoverId?.(slider.id);
      return;
    }
    const hit = topHit(e, el, camera(), size(), props.trace)[0];
    props.onHoverId?.(hit?.id ?? null);
  }

  function onPointerMove(e: PointerEvent) {
    if (props.placing) {
      const filter = props.scope ? snapFilterOf(props.scope) : undefined;
      const hit = placeFromEvent(e, paneEl(), camera(), size(), props.trace, props.toolSession, filter, props.scope);
      props.onCursor?.(hit);
      const session = props.toolSession;
      props.onHoverId?.(session ? hoverTool(session, hit, props.trace, props.scope) : null);
    } else noteHover(e);
  }

  const strokes = createMemo(() => props.trace.filter((n) => isFiniteTrace(n) && n.kind !== "slider"));
  const chrome = createMemo(() => toolChrome(props.placing ? props.toolSession : null));
  const fills = createMemo(() =>
    chrome().hideFills ? [] : strokes().filter((n) => isProfile(n.value)),
  );
  const ink = createMemo(() =>
    strokes().filter((n) => n.kind !== "point" && !isGlider(n.value) && !isProfile(n.value)),
  );
  const points = createMemo(() => strokes().filter((n) => n.kind === "point" || isGlider(n.value)));
  const handles = createMemo(() =>
    strokes().filter((n) => n.editable && (n.kind === "point" || isGlider(n.value))),
  );
  const sliders = createMemo(() => sliderNodes(props.trace));
  const grabbingHover = createMemo(() => isGrabbable(hoverNode(props.trace, props.hoverId)));
  const eligibleCarriers = createMemo(() =>
    props.placing
      ? profileEligibleCarriers(
          props.toolSession,
          props.trace,
          camera(),
          props.scope ? snapFilterOf(props.scope) : undefined,
        )
      : null,
  );
  const fillBand = createMemo(() => liftSelected(fills(), (n) => isSelected(n, props.selectedKey)));
  const inkBand = createMemo(() => liftSelected(ink(), (n) => isSelected(n, props.selectedKey)));
  const pointBand = createMemo(() => liftSelected(points(), (n) => isSelected(n, props.selectedKey)));
  const handleBand = createMemo(() => liftSelected(handles(), (n) => isSelected(n, props.selectedKey)));
  const hoverFills = createMemo(() => fillBand().rest.filter((n) => isHot(n, props.hoverId, props.selectedKey)));
  const hoverInk = createMemo(() => inkBand().rest.filter((n) => isHot(n, props.hoverId, props.selectedKey)));
  const hoverPoints = createMemo(() => pointBand().rest.filter((n) => isHot(n, props.hoverId, props.selectedKey)));

  return (
    <div
      ref={setPaneEl}
      class={[
        styles.paper,
        {
          [styles.grabbing]: drag.phase() === "dragging",
          [styles.grab]: grabbingHover() && drag.phase() !== "dragging" && !props.placing,
          [styles.placing]: !!props.placing,
        },
      ]}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerLeave={() => {
        props.onHoverId?.(null);
        props.onCursor?.(null);
      }}
    >
      <svg class={styles.world} viewBox={vb()}>
        <g transform={worldXf()}>
          <Grid camera={camera()} size={size()} />
          <For each={fillBand().rest}>
            {(n) => (
              <ProfileFill
                node={n}
                hot={isHot(n, props.hoverId, props.selectedKey)}
                selected={isSelected(n, props.selectedKey)}
                knockout={drag.phase() !== "dragging"}
              />
            )}
          </For>
          <For each={hoverFills()}>
            {(n) => (
              <ProfileOutline
                node={n}
                hot={isHot(n, props.hoverId, props.selectedKey)}
                selected={isSelected(n, props.selectedKey)}
                overlay={true}
                knockout={drag.phase() !== "dragging"}
              />
            )}
          </For>
          <For each={fillBand().lifted}>
            {(n) => (
              <ProfileFill
                node={n}
                hot={isHot(n, props.hoverId, props.selectedKey)}
                selected={isSelected(n, props.selectedKey)}
                knockout={drag.phase() !== "dragging"}
              />
            )}
          </For>
          <For each={fillBand().lifted}>
            {(n) => (
              <ProfileOutline
                node={n}
                hot={isHot(n, props.hoverId, props.selectedKey)}
                selected={isSelected(n, props.selectedKey)}
                overlay={true}
                knockout={drag.phase() !== "dragging"}
              />
            )}
          </For>
          <For each={inkBand().rest}>
            {(n) => (
              <Stroke
                node={n}
                hot={isHot(n, props.hoverId, props.selectedKey)}
                selected={isSelected(n, props.selectedKey)}
                muted={
                  chrome().muteStrokes ||
                  (eligibleCarriers() != null && !(n.bind != null && eligibleCarriers()!.has(n.bind))) ||
                  (!!props.scope && mutedForScope(n, props.scope))
                }
                camera={camera()}
                size={size()}
                knockout={drag.phase() !== "dragging"}
              />
            )}
          </For>
          <For each={hoverInk()}>
            {(n) => (
              <Stroke
                node={n}
                hot={isHot(n, props.hoverId, props.selectedKey)}
                selected={isSelected(n, props.selectedKey)}
                muted={
                  chrome().muteStrokes ||
                  (eligibleCarriers() != null && !(n.bind != null && eligibleCarriers()!.has(n.bind))) ||
                  (!!props.scope && mutedForScope(n, props.scope))
                }
                camera={camera()}
                size={size()}
                overlay={true}
                knockout={drag.phase() !== "dragging"}
              />
            )}
          </For>
          <For each={inkBand().lifted}>
            {(n) => (
              <Stroke
                node={n}
                hot={isHot(n, props.hoverId, props.selectedKey)}
                selected={isSelected(n, props.selectedKey)}
                muted={
                  chrome().muteStrokes ||
                  (eligibleCarriers() != null && !(n.bind != null && eligibleCarriers()!.has(n.bind))) ||
                  (!!props.scope && mutedForScope(n, props.scope))
                }
                camera={camera()}
                size={size()}
                knockout={drag.phase() !== "dragging"}
              />
            )}
          </For>
          <For each={inkBand().lifted}>
            {(n) => (
              <Stroke
                node={n}
                hot={isHot(n, props.hoverId, props.selectedKey)}
                selected={isSelected(n, props.selectedKey)}
                muted={
                  chrome().muteStrokes ||
                  (eligibleCarriers() != null && !(n.bind != null && eligibleCarriers()!.has(n.bind))) ||
                  (!!props.scope && mutedForScope(n, props.scope))
                }
                camera={camera()}
                size={size()}
                overlay={true}
                knockout={drag.phase() !== "dragging"}
              />
            )}
          </For>
          {props.ghost?.kind === "profile" ? (
            <ProfileGhost ghost={props.ghost} camera={camera()} />
          ) : null}
        </g>
      </svg>
      <svg class={styles.hud} viewBox={`0 0 ${size().w} ${size().h}`} preserveAspectRatio="none">
        <For each={pointBand().rest}>
          {(n) => (
            <PointMark
              node={n}
              size={size()}
              camera={camera()}
              hot={isHot(n, props.hoverId, props.selectedKey)}
              selected={isSelected(n, props.selectedKey)}
              muted={chrome().mutePoints || (!!props.scope && mutedForScope(n, props.scope))}
              knockout={drag.phase() !== "dragging"}
            />
          )}
        </For>
        <For each={hoverPoints()}>
          {(n) => (
            <PointMark
              node={n}
              size={size()}
              camera={camera()}
              hot={isHot(n, props.hoverId, props.selectedKey)}
              selected={isSelected(n, props.selectedKey)}
              muted={chrome().mutePoints || (!!props.scope && mutedForScope(n, props.scope))}
              overlay={true}
              knockout={drag.phase() !== "dragging"}
            />
          )}
        </For>
        <For each={pointBand().lifted}>
          {(n) => (
            <PointMark
              node={n}
              size={size()}
              camera={camera()}
              hot={isHot(n, props.hoverId, props.selectedKey)}
              selected={isSelected(n, props.selectedKey)}
              muted={chrome().mutePoints || (!!props.scope && mutedForScope(n, props.scope))}
              knockout={drag.phase() !== "dragging"}
            />
          )}
        </For>
        <For each={pointBand().lifted}>
          {(n) => (
            <PointMark
              node={n}
              size={size()}
              camera={camera()}
              hot={isHot(n, props.hoverId, props.selectedKey)}
              selected={isSelected(n, props.selectedKey)}
              muted={chrome().mutePoints || (!!props.scope && mutedForScope(n, props.scope))}
              overlay={true}
              knockout={drag.phase() !== "dragging"}
            />
          )}
        </For>
        <For each={handleBand().rest}>
          {(n) => (
            <Handle
              node={n}
              size={size()}
              camera={camera()}
              hot={isHot(n, props.hoverId, props.selectedKey)}
              selected={isSelected(n, props.selectedKey)}
              muted={chrome().mutePoints}
            />
          )}
        </For>
        <For each={handleBand().lifted}>
          {(n) => (
            <Handle
              node={n}
              size={size()}
              camera={camera()}
              hot={isHot(n, props.hoverId, props.selectedKey)}
              selected={isSelected(n, props.selectedKey)}
              muted={chrome().mutePoints}
            />
          )}
        </For>
        {props.placing && !chrome().hideSnap && props.place && props.place.point.kind !== "free" ? (
          <PlaceSnap point={props.place.point} camera={camera()} size={size()} />
        ) : null}
        {props.ghost && props.ghost.kind !== "profile" ? (
          <GhostMark ghost={props.ghost} camera={camera()} size={size()} />
        ) : null}
        <NumberSliders nodes={sliders()} hotId={props.hoverId} selectedKey={props.selectedKey} />
      </svg>
    </div>
  );
}
