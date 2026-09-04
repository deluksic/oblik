import { For, createEffect, createMemo, createSignal } from "solid-js";

import type { TraceNode } from "@/eval/context";
import { isFillGeom } from "@/geom/csg2";
import { isGlider } from "@/geom/gliders";

import {
  kWorldToNdc,
  viewBox,
  wheelZoomFactor,
  zoomAt,
  type Camera2,
  type PaneSize,
} from "../camera";
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
import { regionEligibleCarriers } from "../tools/region";
import { ChromeBand } from "./ChromeBand";
import { createDragHandler, type DragSession } from "./createDragHandler";
import { GhostMark } from "./Ghost";
import { Grid } from "./Grid";
import { Handle, PlaceSnap, PointMark } from "./Hud";
import { RegionFill, RegionGhost, RegionOutline, Stroke } from "./Ink";
import {
  isGrabbable,
  isHot,
  isHover,
  isSelected,
  hoverNode,
  liftSelected,
  chromeSplitEqual,
  splitChrome,
  sameList,
  type ChromeSplit,
} from "./marks";
import { NumberSliders } from "./NumberSliders";
import {
  applyDrag,
  editDragOf,
  panDrag,
  placeFromEvent,
  sliderDrag,
  topHit,
  type EditDrag,
} from "./pointer";
import { hitSlider, sliderNodes } from "./sliderHud";

import styles from "./View.module.css";

const DEFAULT_CAMERA: Camera2 = { x: 0, y: 0, scale: 48 };

export type Euclid2ViewProps = {
  trace: TraceNode[];
  initialCamera?: Camera2;
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
  /** True while an edit drag is past the dead zone; false on release/cancel. */
  onLiveEdit?: (live: boolean) => void;
  onPlace?: (hit: PlaceHit) => void;
  onCursor?: (hit: PlaceHit | undefined) => void;
  scope?: Scope;
};

function readPaneSize(el: Element): PaneSize | undefined {
  const r = el.getBoundingClientRect();
  if (r.width < 8 || r.height < 8) return undefined;
  return { w: r.width, h: r.height };
}

function screenOf(e: PointerEvent, el: HTMLDivElement): { x: number; y: number } {
  const rect = el.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

export function Euclid2View(props: Euclid2ViewProps) {
  const [paneEl, setPaneEl] = createSignal<HTMLDivElement | undefined>(undefined);
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
    const hit = placeFromEvent(
      e,
      el,
      camera(),
      size(),
      props.trace,
      props.toolSession,
      filter,
      props.scope,
    );
    const nearest = topHit(e, el, camera(), size(), props.trace)[0];
    if (nearest && filter?.keys && !filter.keys.has(traceKey(nearest)) && hit.point.kind === "free")
      return;
    props.onPlace?.(hit);
  }

  const drag = createDragHandler({ deadZoneRadius: PICK_CLICK_PX, preventDefault: false });

  function editSession(session: EditDrag): DragSession {
    let moved = false;
    let live = false;
    return {
      onPointerMove(ev) {
        moved = true;
        const next = applyDrag(session, ev, paneEl(), camera(), size(), props.trace);
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

  // oxlint-disable-next-line solid/reactivity -- drag.start factory runs at pointerdown; snapshot semantics are intentional.
  const startPan = drag.start((e, hits: TraceNode[]) => {
    const initialStart = panDrag(e, camera());
    const pick = hits.length > 0 ? hits : undefined;
    let moved = false;
    return {
      onPointerMove(ev) {
        moved = true;
        const next = applyDrag(initialStart, ev, paneEl(), camera(), size(), props.trace);
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
    props.onHoverId?.(hit?.id ?? undefined);
  }

  function onPointerMove(e: PointerEvent) {
    if (props.placing) {
      const filter = props.scope ? snapFilterOf(props.scope) : undefined;
      const hit = placeFromEvent(
        e,
        paneEl(),
        camera(),
        size(),
        props.trace,
        props.toolSession,
        filter,
        props.scope,
      );
      props.onCursor?.(hit);
      const session = props.toolSession;
      props.onHoverId?.(session ? hoverTool(session, hit, props.trace, props.scope) : undefined);
    } else noteHover(e);
  }

  const strokes = createMemo(
    () => props.trace.filter((n) => isFiniteTrace(n) && n.kind !== "slider"),
    { equals: sameList },
  );
  const chrome = createMemo(() => toolChrome(props.placing ? props.toolSession : undefined));
  const fills = createMemo(
    () => (chrome().hideFills ? [] : strokes().filter((n) => isFillGeom(n.value))),
    {
      equals: sameList,
    },
  );
  const ink = createMemo(
    () => strokes().filter((n) => n.kind !== "point" && !isGlider(n.value) && !isFillGeom(n.value)),
    { equals: sameList },
  );
  const points = createMemo(
    () => strokes().filter((n) => n.kind === "point" || isGlider(n.value)),
    { equals: sameList },
  );
  const handles = createMemo(
    () => strokes().filter((n) => n.editable && (n.kind === "point" || isGlider(n.value))),
    { equals: sameList },
  );
  const sliders = createMemo(() => sliderNodes(props.trace), { equals: sameList });
  const grabbingHover = createMemo(() => isGrabbable(hoverNode(props.trace, props.hoverId)));
  const eligibleCarriers = createMemo(() =>
    props.placing
      ? regionEligibleCarriers(
          props.toolSession,
          props.trace,
          camera(),
          props.scope ? snapFilterOf(props.scope) : undefined,
        )
      : undefined,
  );
  const fillBand = createMemo(
    () =>
      splitChrome(
        fills(),
        (n) => isSelected(n, props.selectedKey),
        (n) => isHover(n, props.hoverId, props.selectedKey),
      ),
    { equals: chromeSplitEqual },
  );
  const inkBand = createMemo(
    () =>
      splitChrome(
        ink(),
        (n) => isSelected(n, props.selectedKey),
        (n) => isHover(n, props.hoverId, props.selectedKey),
      ),
    { equals: chromeSplitEqual },
  );
  const pointBand = createMemo(
    () =>
      splitChrome(
        points(),
        (n) => isSelected(n, props.selectedKey),
        (n) => isHover(n, props.hoverId, props.selectedKey),
      ),
    { equals: chromeSplitEqual },
  );
  const handleBand = createMemo(
    () => liftSelected(handles(), (n) => isSelected(n, props.selectedKey)),
    { equals: (a, b) => sameList(a.rest, b.rest) && sameList(a.lifted, b.lifted) },
  );

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
        props.onHoverId?.(undefined);
        props.onCursor?.(undefined);
      }}
    >
      <svg class={styles.world} viewBox={vb()}>
        <g transform={worldXf()}>
          <Grid camera={camera()} size={size()} />
          <RegionChrome
            band={fillBand()}
            hoverId={props.hoverId}
            selectedKey={props.selectedKey}
            halos={drag.phase() !== "dragging"}
          />
          <StrokeChrome
            band={inkBand()}
            hoverId={props.hoverId}
            selectedKey={props.selectedKey}
            muted={(n) =>
              chrome().muteStrokes ||
              (eligibleCarriers() !== undefined &&
                !(n.bind !== undefined && eligibleCarriers()!.has(n.bind))) ||
              (!!props.scope && mutedForScope(n, props.scope))
            }
            camera={camera()}
            size={size()}
            halos={drag.phase() !== "dragging"}
          />
          {props.ghost?.kind === "region" ? (
            <RegionGhost ghost={props.ghost} camera={camera()} />
          ) : undefined}
        </g>
      </svg>
      <svg class={styles.hud} viewBox={`0 0 ${size().w} ${size().h}`} preserveAspectRatio="none">
        <PointChrome
          band={pointBand()}
          hoverId={props.hoverId}
          selectedKey={props.selectedKey}
          muted={(n) => chrome().mutePoints || (!!props.scope && mutedForScope(n, props.scope))}
          camera={camera()}
          size={size()}
          halos={drag.phase() !== "dragging"}
        />
        <For each={handleBand().rest} keyed={(n) => traceKey(n)}>
          {(n) => (
            <Handle
              node={n()}
              size={size()}
              camera={camera()}
              hot={isHot(n(), props.hoverId, props.selectedKey)}
              selected={isSelected(n(), props.selectedKey)}
              muted={chrome().mutePoints}
            />
          )}
        </For>
        <For each={handleBand().lifted} keyed={(n) => traceKey(n)}>
          {(n) => (
            <Handle
              node={n()}
              size={size()}
              camera={camera()}
              hot={isHot(n(), props.hoverId, props.selectedKey)}
              selected={isSelected(n(), props.selectedKey)}
              muted={chrome().mutePoints}
            />
          )}
        </For>
        {props.placing && !chrome().hideSnap && props.place && props.place.point.kind !== "free" ? (
          <PlaceSnap point={props.place.point} camera={camera()} size={size()} />
        ) : undefined}
        {props.ghost && props.ghost.kind !== "region" ? (
          <GhostMark ghost={props.ghost} camera={camera()} size={size()} />
        ) : undefined}
        <NumberSliders nodes={sliders()} hotId={props.hoverId} selectedKey={props.selectedKey} />
      </svg>
    </div>
  );
}

function RegionChrome(props: {
  band: ChromeSplit<TraceNode>;
  hoverId?: string | undefined;
  selectedKey?: string | undefined;
  halos?: boolean;
}) {
  return (
    <ChromeBand band={props.band} halos={props.halos} keyed={traceKey}>
      {(n, overlay) =>
        overlay ? (
          <RegionOutline
            node={n()}
            hot={isHot(n(), props.hoverId, props.selectedKey)}
            selected={isSelected(n(), props.selectedKey)}
            overlay
          />
        ) : (
          <RegionFill
            node={n()}
            hot={isHot(n(), props.hoverId, props.selectedKey)}
            selected={isSelected(n(), props.selectedKey)}
          />
        )
      }
    </ChromeBand>
  );
}

function StrokeChrome(props: {
  band: ChromeSplit<TraceNode>;
  hoverId?: string | undefined;
  selectedKey?: string | undefined;
  muted: (n: TraceNode) => boolean;
  camera: Camera2;
  size: PaneSize;
  halos?: boolean;
}) {
  return (
    <ChromeBand band={props.band} halos={props.halos} keyed={traceKey}>
      {(n, overlay) => (
        <Stroke
          node={n()}
          hot={isHot(n(), props.hoverId, props.selectedKey)}
          selected={isSelected(n(), props.selectedKey)}
          muted={props.muted(n())}
          camera={props.camera}
          size={props.size}
          overlay={overlay}
        />
      )}
    </ChromeBand>
  );
}

function PointChrome(props: {
  band: ChromeSplit<TraceNode>;
  hoverId?: string | undefined;
  selectedKey?: string | undefined;
  muted: (n: TraceNode) => boolean;
  camera: Camera2;
  size: PaneSize;
  halos?: boolean;
}) {
  return (
    <ChromeBand band={props.band} halos={props.halos} keyed={traceKey}>
      {(n, overlay) => (
        <PointMark
          node={n()}
          size={props.size}
          camera={props.camera}
          hot={isHot(n(), props.hoverId, props.selectedKey)}
          selected={isSelected(n(), props.selectedKey)}
          muted={props.muted(n())}
          overlay={overlay}
        />
      )}
    </ChromeBand>
  );
}
