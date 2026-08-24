import { For, createMemo, createSignal, onSettled } from "solid-js";

import type { TraceNode } from "../eval/context";
import type { Circle, Line, OffsetLine, Point, Segment } from "../geom";
import {
  clientToNdc,
  infiniteClip,
  kWorldToNdc,
  ndcToWorld,
  viewBox,
  worldToNdc,
  type Camera2,
  type PaneSize,
} from "./camera";
import styles from "./View.module.css";

export type Euclid2ViewProps = {
  trace: TraceNode[];
  camera: Camera2;
  onCamera: (cam: Camera2) => void;
  onDraft: (id: string, values: number[]) => void;
  onCommit: (id: string, values: number[]) => void;
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

function finite(n: TraceNode): boolean {
  const v = n.value;
  if (v.kind === "point") return Number.isFinite(v.x) && Number.isFinite(v.y);
  if (v.kind === "circle") return Number.isFinite(v.radius) && Number.isFinite(v.center.x);
  if (v.kind === "segment") return Number.isFinite(v.a.x) && Number.isFinite(v.b.x);
  if (v.kind === "line") return Number.isFinite(v.origin.x);
  if (v.kind === "offsetLine") return Number.isFinite(v.distance);
  return false;
}

export function Euclid2View(props: Euclid2ViewProps) {
  const svgRef: { current: SVGSVGElement | null } = { current: null };
  const [size, setSize] = createSignal<PaneSize>({ w: 800, h: 600 });
  const [hover, setHover] = createSignal<string | null>(null);
  const [grabbing, setGrabbing] = createSignal(false);
  let drag: Drag | null = null;

  onSettled(() => {
    const el = svgRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ w: Math.max(1, r.width), h: Math.max(1, r.height) });
    });
    ro.observe(el);
    const r = el.getBoundingClientRect();
    setSize({ w: Math.max(1, r.width), h: Math.max(1, r.height) });
    return () => ro.disconnect();
  });

  const k = createMemo(() => kWorldToNdc(props.camera, size()));
  const vb = createMemo(() => viewBox(size()));
  const worldXf = createMemo(() => {
    const cam = props.camera;
    const kk = k();
    return `scale(${kk} ${-kk}) translate(${-cam.x} ${-cam.y})`;
  });

  function worldOf(e: PointerEvent) {
    const el = svgRef.current!;
    const rect = el.getBoundingClientRect();
    const ndc = clientToNdc({ x: e.clientX, y: e.clientY }, rect, size());
    return ndcToWorld(ndc, props.camera, size());
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    const cam = props.camera;
    const factor = e.deltaY < 0 ? 1.08 : 1 / 1.08;
    const scale = Math.min(280, Math.max(8, cam.scale * factor));
    props.onCamera({ ...cam, scale });
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    const el = svgRef.current;
    if (!el) return;
    el.setPointerCapture(e.pointerId);
    const t = e.target;
    if (t instanceof Element && t.hasAttribute("data-handle")) {
      const id = t.getAttribute("data-handle")!;
      const kind = t.getAttribute("data-kind");
      const node = props.trace.find((n) => n.id === id && n.occ === 0) ?? props.trace.find((n) => n.id === id);
      if (!node) return;
      const w = worldOf(e);
      if (kind === "point" && node.value.kind === "point") {
        drag = { kind: "point", id, startX: node.value.x, startY: node.value.y, pointerX: w.x, pointerY: w.y };
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
    drag = { kind: "pan", x: e.clientX, y: e.clientY, camX: props.camera.x, camY: props.camera.y };
    setGrabbing(true);
  }

  function onPointerMove(e: PointerEvent) {
    if (!drag) return;
    if (drag.kind === "pan") {
      const cam = props.camera;
      props.onCamera({
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
    drag = null;
    setGrabbing(false);
    if (!d || d.kind === "pan") return;
    const w = worldOf(e);
    if (d.kind === "point") {
      props.onCommit(d.id, [round(d.startX + (w.x - d.pointerX)), round(d.startY + (w.y - d.pointerY))]);
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
  const handleR = createMemo(() => 7 / Math.max(1, size().h / 2));

  return (
    <div class={styles.paper}>
      <svg
        ref={(el) => {
          svgRef.current = el;
        }}
        class={[styles.svg, { [styles.grabbing]: grabbing() }]}
        viewBox={vb()}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={() => setHover(null)}
      >
        <g transform={worldXf()}>
          <Grid camera={props.camera} size={size()} />
          <For each={ink()}>{(n) => <Stroke node={n} hot={hover() === n.id} camera={props.camera} size={size()} />}</For>
        </g>
        <For each={points()}>
          {(n) => (
            <PointMark
              node={n}
              size={size()}
              camera={props.camera}
              r={handleR() * 0.45}
              hot={hover() === n.id}
            />
          )}
        </For>
        <For each={handles()}>
          {(n) => (
            <Handle
              node={n}
              size={size()}
              camera={props.camera}
              r={handleR()}
              hot={hover() === n.id}
              onEnter={() => setHover(n.id)}
              onLeave={() => setHover(null)}
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

function Stroke(props: { node: TraceNode; hot: boolean; camera: Camera2; size: PaneSize }) {
  const kind = createMemo(() => props.node.value.kind);
  return (
    <>
      {kind() === "segment" ? <SegmentStroke node={props.node} hot={props.hot} /> : null}
      {kind() === "line" || kind() === "offsetLine" ? (
        <Infinite node={props.node} hot={props.hot} camera={props.camera} size={props.size} />
      ) : null}
      {kind() === "circle" ? <CircleStroke node={props.node} hot={props.hot} /> : null}
    </>
  );
}

function SegmentStroke(props: { node: TraceNode; hot: boolean }) {
  const s = () => props.node.value as Segment;
  const cls = () => [styles.stroke, { [styles.hot]: props.hot }];
  return (
    <>
      <line class={styles.hit} x1={s().a.x} y1={s().a.y} x2={s().b.x} y2={s().b.y} />
      <line class={cls()} x1={s().a.x} y1={s().a.y} x2={s().b.x} y2={s().b.y} />
    </>
  );
}

function CircleStroke(props: { node: TraceNode; hot: boolean }) {
  const c = () => props.node.value as Circle;
  const cls = () => [styles.stroke, { [styles.hot]: props.hot }];
  return (
    <>
      <circle class={styles.hit} cx={c().center.x} cy={c().center.y} r={c().radius} />
      <circle class={cls()} cx={c().center.x} cy={c().center.y} r={c().radius} />
    </>
  );
}

function Infinite(props: { node: TraceNode; hot: boolean; camera: Camera2; size: PaneSize }) {
  const ends = createMemo(() => {
    const v = props.node.value;
    const origin = v.kind === "offsetLine" ? (v as OffsetLine).line.origin : (v as Line).origin;
    const dir = v.kind === "offsetLine" ? (v as OffsetLine).line.direction : (v as Line).direction;
    return infiniteClip(origin, dir, props.camera, props.size);
  });
  const cls = () => [styles.stroke, { [styles.hot]: props.hot }];
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

function PointMark(props: { node: TraceNode; size: PaneSize; camera: Camera2; r: number; hot: boolean }) {
  const pos = createMemo(() => worldToNdc(props.node.value as Point, props.camera, props.size));
  return (
    <>
      <circle
        class={[styles.point, { [styles.hotFill]: props.hot }]}
        cx={pos().x}
        cy={pos().y}
        r={props.r}
        pointer-events="none"
      />
      {props.node.bind ? (
        <text
          class={styles.label}
          x={pos().x + props.r * 2.2}
          y={pos().y - props.r * 1.4}
          font-size={String(props.r * 2.6)}
        >
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
  r: number;
  hot: boolean;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const pos = createMemo(() => {
    const v = props.node.value;
    if (v.kind === "point") return worldToNdc(v, props.camera, props.size);
    if (v.kind === "circle") {
      const c = v as Circle;
      return worldToNdc({ x: c.center.x + c.radius, y: c.center.y }, props.camera, props.size);
    }
    return { x: 0, y: 0 };
  });
  const kind = () => (props.node.kind === "circle" ? "radius" : "point");
  return (
    <circle
      class={[styles.handle, { [styles.handleHot]: props.hot }]}
      data-handle={props.node.id}
      data-kind={kind()}
      cx={pos().x}
      cy={pos().y}
      r={props.r}
      onPointerEnter={props.onEnter}
      onPointerLeave={props.onLeave}
    />
  );
}
