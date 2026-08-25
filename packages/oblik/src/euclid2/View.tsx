import { For, createMemo, createSignal, onSettled } from "solid-js";

import type { TraceNode } from "../eval/context";
import type { Circle, Line, OffsetLine, Point, Segment } from "../geom";
import {
  clientToNdc,
  infiniteClip,
  kWorldToNdc,
  ndcToWorld,
  viewBox,
  worldToScreen,
  type Camera2,
  type PaneSize,
} from "./camera";
import { snapBoundPoint, hitsNear, movedPastClick, traceKey } from "./pick";
import type { Ghost, PlaceHit } from "./tool";

import styles from "./View.module.css";

const DEFAULT_CAMERA: Camera2 = { x: 0, y: 0, scale: 48 };

export type Euclid2ViewProps = {
  trace: TraceNode[];
  initialCamera?: Camera2;
  placing?: boolean;
  ghost?: Ghost | null;
  hoverId?: string | null;
  selectedKey?: string | null;
  onHoverId?: (id: string | null) => void;
  onPick?: (hits: TraceNode[]) => void;
  onDraft: (id: string, values: number[]) => void;
  onCommit: (id: string, values: number[]) => void;
  onPlace?: (hit: PlaceHit) => void;
  onCursor?: (world: { x: number; y: number } | null) => void;
};

type Drag =
  | {
      kind: "pan";
      x: number;
      y: number;
      camX: number;
      camY: number;
    }
  | {
      kind: "point";
      id: string;
      startX: number;
      startY: number;
      pointerX: number;
      pointerY: number;
    }
  | {
      kind: "radius";
      id: string;
      startR: number;
      origin: { x: number; y: number };
      grabDist: number;
    };

type PendingPick = {
  hits: TraceNode[];
  x: number;
  y: number;
};

function isHot(node: TraceNode, hoverId: string | null | undefined, selectedKey: string | null | undefined): boolean {
  return hoverId === node.id || traceKey(node) === selectedKey;
}

function isSelected(node: TraceNode, selectedKey: string | null | undefined): boolean {
  return traceKey(node) === selectedKey;
}

function finite(n: TraceNode): boolean {
  const v = n.value;
  if (v.kind === "point") return Number.isFinite(v.x) && Number.isFinite(v.y);
  if (v.kind === "circle") return Number.isFinite(v.radius) && Number.isFinite(v.center.x);
  if (v.kind === "segment") return Number.isFinite(v.a.x) && Number.isFinite(v.b.x);
  if (v.kind === "line") return Number.isFinite(v.origin.x);
  if (v.kind === "offsetLine") return Number.isFinite(v.distance);
  return false;
}

function readPaneSize(el: Element): PaneSize | null {
  const r = el.getBoundingClientRect();
  if (r.width < 8 || r.height < 8) return null;
  return { w: r.width, h: r.height };
}

export function Euclid2View(props: Euclid2ViewProps) {
  const paneRef: { current: HTMLDivElement | null } = { current: null };
  const initialCameraMemo = createMemo(() => props.initialCamera, {
    equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  });
  const [camera, setCamera] = createSignal<Camera2>(() => initialCameraMemo() ?? DEFAULT_CAMERA);
  const [size, setSize] = createSignal<PaneSize>({ w: 800, h: 600 });
  const [grabbing, setGrabbing] = createSignal(false);
  let drag: Drag | null = null;
  let pendingPick: PendingPick | null = null;

  onSettled(() => {
    const el = paneRef.current;
    if (!el) return;
    const apply = () => {
      const next = readPaneSize(el);
      if (next) setSize(next);
    };
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    apply();
    return () => ro.disconnect();
  });

  const k = createMemo(() => kWorldToNdc(camera(), size()));
  const vb = createMemo(() => viewBox(size()));
  const worldXf = createMemo(() => {
    const cam = camera();
    const kk = k();
    return `scale(${kk} ${-kk}) translate(${-cam.x} ${-cam.y})`;
  });

  function worldOf(e: PointerEvent) {
    const el = paneRef.current!;
    const rect = el.getBoundingClientRect();
    const ndc = clientToNdc({ x: e.clientX, y: e.clientY }, rect, size());
    return ndcToWorld(ndc, camera(), size());
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    const cam = camera();
    const factor = e.deltaY < 0 ? 1.08 : 1 / 1.08;
    const scale = Math.min(280, Math.max(8, cam.scale * factor));
    setCamera({ ...cam, scale });
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    const el = paneRef.current;
    if (!el) return;
    if (props.placing) {
      const w = worldOf(e);
      const max = 16 / Math.max(8, camera().scale);
      let snap = snapBoundPoint(props.trace, w, max);
      const t = e.target;
      if (t instanceof Element && t.hasAttribute("data-handle")) {
        const id = t.getAttribute("data-handle")!;
        const node = props.trace.find((n) => n.id === id);
        if (node?.bind && node.value.kind === "point") {
          snap = { id: node.id, bind: node.bind, at: { x: node.value.x, y: node.value.y } };
        }
      }
      props.onPlace?.({ world: w, snap: snap ?? undefined });
      return;
    }
    el.setPointerCapture(e.pointerId);
    const t = e.target;
    if (t instanceof Element && t.hasAttribute("data-handle")) {
      const id = t.getAttribute("data-handle")!;
      const kind = t.getAttribute("data-kind");
      const node =
        props.trace.find((n) => n.id === id && n.occ === 0) ?? props.trace.find((n) => n.id === id);
      if (!node) return;
      const w = worldOf(e);
      if (kind === "point" && node.value.kind === "point") {
        drag = {
          kind: "point",
          id,
          startX: node.value.x,
          startY: node.value.y,
          pointerX: w.x,
          pointerY: w.y,
        };
      } else if (kind === "radius" && node.value.kind === "circle") {
        const c = node.value.center;
        drag = {
          kind: "radius",
          id,
          startR: node.value.radius,
          origin: c,
          grabDist: Math.hypot(w.x - c.x, w.y - c.y),
        };
      }
      setGrabbing(true);
      return;
    }
    drag = { kind: "pan", x: e.clientX, y: e.clientY, camX: camera().x, camY: camera().y };
    if (!props.placing) {
      const w = worldOf(e);
      const hits = hitsNear(props.trace, w, camera(), size());
      pendingPick = hits.length > 0 ? { hits, x: e.clientX, y: e.clientY } : null;
    } else {
      pendingPick = null;
    }
    setGrabbing(true);
  }

  function noteHover(e: PointerEvent) {
    if (props.placing || drag) return;
    const w = worldOf(e);
    const hit = hitsNear(props.trace, w, camera(), size())[0];
    props.onHoverId?.(hit?.id ?? null);
  }

  function onPointerMove(e: PointerEvent) {
    if (props.placing) {
      props.onCursor?.(worldOf(e));
    } else {
      noteHover(e);
    }
    if (!drag) return;
    if (drag.kind === "pan") {
      const cam = camera();
      setCamera({
        ...cam,
        x: drag.camX - (e.clientX - drag.x) / cam.scale,
        y: drag.camY + (e.clientY - drag.y) / cam.scale,
      });
      return;
    }
    const w = worldOf(e);
    if (drag.kind === "point") {
      const nx = drag.startX + (w.x - drag.pointerX);
      const ny = drag.startY + (w.y - drag.pointerY);
      props.onDraft(drag.id, [round(nx), round(ny)]);
    } else {
      const now = Math.hypot(w.x - drag.origin.x, w.y - drag.origin.y);
      const r = Math.max(0.05, drag.startR + (now - drag.grabDist));
      props.onDraft(drag.id, [round(r)]);
    }
  }

  function endDrag(e: PointerEvent) {
    const d = drag;
    const pick = pendingPick;
    drag = null;
    pendingPick = null;
    setGrabbing(false);
    if (d?.kind === "pan") {
      if (!movedPastClick(d.x, d.y, e.clientX, e.clientY)) {
        props.onPick?.(pick?.hits ?? []);
      }
      return;
    }
    if (!d) return;
    const w = worldOf(e);
    if (d.kind === "point") {
      props.onCommit(d.id, [
        round(d.startX + (w.x - d.pointerX)),
        round(d.startY + (w.y - d.pointerY)),
      ]);
    } else {
      const now = Math.hypot(w.x - d.origin.x, w.y - d.origin.y);
      props.onCommit(d.id, [round(Math.max(0.05, d.startR + (now - d.grabDist)))]);
    }
  }

  const strokes = createMemo(() => props.trace.filter(finite));
  const ink = createMemo(() => strokes().filter((n) => n.kind !== "point"));
  const points = createMemo(() => strokes().filter((n) => n.kind === "point"));
  const handles = createMemo(() =>
    strokes().filter((n) => n.editable && (n.kind === "point" || n.kind === "circle")),
  );
  return (
    <div
      ref={(el) => {
        paneRef.current = el;
      }}
      class={[styles.paper, { [styles.grabbing]: grabbing(), [styles.placing]: !!props.placing }]}
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
          {props.ghost ? <GhostMark ghost={props.ghost} /> : null}
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
              onEnter={() => props.onHoverId?.(n.id)}
              onLeave={() => props.onHoverId?.(null)}
            />
          )}
        </For>
      </svg>
    </div>
  );
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function Stroke(props: {
  node: TraceNode;
  hot: boolean;
  selected: boolean;
  camera: Camera2;
  size: PaneSize;
}) {
  const kind = createMemo(() => props.node.value.kind);
  return (
    <>
      {kind() === "segment" ? (
        <SegmentStroke node={props.node} hot={props.hot} selected={props.selected} />
      ) : null}
      {kind() === "line" || kind() === "offsetLine" ? (
        <Infinite
          node={props.node}
          hot={props.hot}
          selected={props.selected}
          camera={props.camera}
          size={props.size}
        />
      ) : null}
      {kind() === "circle" ? (
        <CircleStroke node={props.node} hot={props.hot} selected={props.selected} />
      ) : null}
    </>
  );
}

function strokeClass(hot: boolean, selected: boolean) {
  return [styles.stroke, { [styles.hot]: hot && !selected, [styles.selected]: selected }];
}

function SegmentStroke(props: { node: TraceNode; hot: boolean; selected: boolean }) {
  const s = () => props.node.value as Segment;
  const cls = () => strokeClass(props.hot, props.selected);
  return (
    <>
      <line class={styles.hit} x1={s().a.x} y1={s().a.y} x2={s().b.x} y2={s().b.y} />
      <line class={cls()} x1={s().a.x} y1={s().a.y} x2={s().b.x} y2={s().b.y} />
    </>
  );
}

function CircleStroke(props: { node: TraceNode; hot: boolean; selected: boolean }) {
  const c = () => props.node.value as Circle;
  const cls = () => strokeClass(props.hot, props.selected);
  return (
    <>
      <circle class={styles.hit} cx={c().center.x} cy={c().center.y} r={c().radius} />
      <circle class={cls()} cx={c().center.x} cy={c().center.y} r={c().radius} />
    </>
  );
}

function Infinite(props: {
  node: TraceNode;
  hot: boolean;
  selected: boolean;
  camera: Camera2;
  size: PaneSize;
}) {
  const ends = createMemo(() => {
    const v = props.node.value;
    const origin = v.kind === "offsetLine" ? (v as OffsetLine).line.origin : (v as Line).origin;
    const dir = v.kind === "offsetLine" ? (v as OffsetLine).line.direction : (v as Line).direction;
    return infiniteClip(origin, dir, props.camera, props.size);
  });
  const cls = () => strokeClass(props.hot, props.selected);
  return (
    <>
      <line class={styles.hit} x1={ends().a.x} y1={ends().a.y} x2={ends().b.x} y2={ends().b.y} />
      <line class={cls()} x1={ends().a.x} y1={ends().a.y} x2={ends().b.x} y2={ends().b.y} />
    </>
  );
}

function Grid(props: { camera: Camera2; size: PaneSize }) {
  const ticks = createMemo(() => {
    const cam = props.camera;
    const size = props.size;
    const halfH = size.h / 2 / cam.scale + 1;
    const halfW = size.w / 2 / cam.scale + 1;
    const x0 = Math.floor(cam.x - halfW);
    const x1 = Math.ceil(cam.x + halfW);
    const y0 = Math.floor(cam.y - halfH);
    const y1 = Math.ceil(cam.y + halfH);
    const xs: number[] = [];
    const ys: number[] = [];
    for (let x = x0; x <= x1; x++) xs.push(x);
    for (let y = y0; y <= y1; y++) ys.push(y);
    return { xs, ys, x0, x1, y0, y1 };
  });
  return (
    <g pointer-events="none">
      <For each={ticks().xs}>
        {(x) => (
          <line
            class={[styles.gridLine, { [styles.axis]: x === 0 }]}
            x1={x}
            y1={ticks().y0}
            x2={x}
            y2={ticks().y1}
          />
        )}
      </For>
      <For each={ticks().ys}>
        {(y) => (
          <line
            class={[styles.gridLine, { [styles.axis]: y === 0 }]}
            x1={ticks().x0}
            y1={y}
            x2={ticks().x1}
            y2={y}
          />
        )}
      </For>
    </g>
  );
}

function GhostMark(props: { ghost: Ghost }) {
  const point = createMemo(() => (props.ghost.kind === "point" ? props.ghost.at : null));
  const circle = createMemo(() => (props.ghost.kind === "circle" ? props.ghost : null));
  const seg = createMemo(() =>
    props.ghost.kind === "line" || props.ghost.kind === "segment" ? props.ghost : null,
  );
  return (
    <>
      {point() ? (
        <circle class={styles.ghostPoint} cx={point()!.x} cy={point()!.y} r={0.08} />
      ) : null}
      {circle() ? (
        <>
          <circle
            class={styles.ghostPoint}
            cx={circle()!.center.x}
            cy={circle()!.center.y}
            r={0.08}
          />
          <circle
            class={styles.ghost}
            cx={circle()!.center.x}
            cy={circle()!.center.y}
            r={circle()!.radius}
          />
        </>
      ) : null}
      {seg() ? (
        <line
          class={styles.ghost}
          x1={seg()!.a.x}
          y1={seg()!.a.y}
          x2={seg()!.b.x}
          y2={seg()!.b.y}
        />
      ) : null}
    </>
  );
}

const HANDLE_R = 7;
const POINT_R = 3.5;

function PointMark(props: {
  node: TraceNode;
  size: PaneSize;
  camera: Camera2;
  hot: boolean;
  selected: boolean;
}) {
  const pos = createMemo(() => worldToScreen(props.node.value as Point, props.camera, props.size));
  const cls = () => [
    styles.point,
    { [styles.hotFill]: props.hot && !props.selected, [styles.selectedFill]: props.selected },
  ];
  return (
    <>
      <circle class={cls()} cx={pos().x} cy={pos().y} r={POINT_R} />
      {props.node.bind ? (
        <text class={styles.label} x={pos().x + 10} y={pos().y - 8} font-size="12">
          {props.node.bind}
        </text>
      ) : null}
    </>
  );
}

function Handle(props: {
  node: TraceNode;
  size: PaneSize;
  camera: Camera2;
  hot: boolean;
  selected: boolean;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const pos = createMemo(() => {
    const v = props.node.value;
    if (v.kind === "point") return worldToScreen(v, props.camera, props.size);
    if (v.kind === "circle") {
      const c = v as Circle;
      return worldToScreen({ x: c.center.x + c.radius, y: c.center.y }, props.camera, props.size);
    }
    return { x: 0, y: 0 };
  });
  const kind = () => (props.node.kind === "circle" ? "radius" : "point");
  return (
    <circle
      class={[
        styles.handle,
        {
          [styles.handleHot]: props.hot && !props.selected,
          [styles.handleSelected]: props.selected,
        },
      ]}
      data-handle={props.node.id}
      data-kind={kind()}
      cx={pos().x}
      cy={pos().y}
      r={HANDLE_R}
      onPointerEnter={props.onEnter}
      onPointerLeave={props.onLeave}
    />
  );
}
