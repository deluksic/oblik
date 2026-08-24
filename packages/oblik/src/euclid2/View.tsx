import { For, createMemo, createSignal, onSettled } from "solid-js";

import type { Annotation } from "../source/analyze";
import type { TraceNode } from "../eval/context";
import type { Circle, Line, OffsetLine, Point, Segment } from "../geom";
import {
  clientToNdc,
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
  annotations?: Record<string, Annotation> | Map<string, Annotation>;
  camera: Camera2;
  draft: Map<string, number[]>;
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
  let svg: SVGSVGElement | undefined;
  const [size, setSize] = createSignal<PaneSize>({ w: 800, h: 600 });
  const [hover, setHover] = createSignal<string | null>(null);
  let drag: Drag | null = null;

  onSettled(() => {
    const el = svg;
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
    const el = svg!;
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
    const el = svg;
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
      return;
    }
    drag = { kind: "pan", x: e.clientX, y: e.clientY, camX: props.camera.x, camY: props.camera.y };
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

  function onPointerUp(e: PointerEvent) {
    const d = drag;
    drag = null;
    if (!d || d.kind === "pan") return;
    const node = props.trace.find((n) => n.id === d.id);
    if (!node) return;
    if (d.kind === "point" && node.value.kind === "point") {
      props.onCommit(d.id, [round(node.value.x), round(node.value.y)]);
    } else if (d.kind === "radius" && node.value.kind === "circle") {
      props.onCommit(d.id, [round(node.value.radius)]);
    }
    void e;
  }

  const strokes = createMemo(() => props.trace.filter(finite));
  const handles = createMemo(() =>
    strokes().filter((n) => n.editable && (n.kind === "point" || n.kind === "circle")),
  );
  const handleR = createMemo(() => 7 / Math.max(1, size().h / 2));

  return (
    <div class={styles.paper}>
      <svg
        ref={(el) => {
          svg = el;
        }}
        class={styles.svg}
        viewBox={vb()}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setHover(null)}
      >
        <g transform={worldXf()}>
          <For each={strokes()}>{(n) => <Stroke node={n} hot={hover() === n.id} />}</For>
        </g>
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

function Stroke(props: { node: TraceNode; hot: boolean }) {
  const v = () => props.node.value;
  const cls = () => [styles.stroke, { [styles.hot]: props.hot }];
  if (v().kind === "segment") {
    const s = v() as Segment;
    return (
      <>
        <line class={styles.hit} x1={s.a.x} y1={s.a.y} x2={s.b.x} y2={s.b.y} />
        <line class={cls()} x1={s.a.x} y1={s.a.y} x2={s.b.x} y2={s.b.y} />
      </>
    );
  }
  if (v().kind === "line" || v().kind === "offsetLine") {
    return <Infinite node={props.node} hot={props.hot} />;
  }
  if (v().kind === "circle") {
    const c = v() as Circle;
    return (
      <>
        <circle class={styles.hit} cx={c.center.x} cy={c.center.y} r={c.radius} />
        <circle class={cls()} cx={c.center.x} cy={c.center.y} r={c.radius} />
      </>
    );
  }
  if (v().kind === "point") {
    const p = v() as Point;
    return <circle class={cls()} cx={p.x} cy={p.y} r={0.06} />;
  }
  return null;
}

function Infinite(props: { node: TraceNode; hot: boolean }) {
  // Clip is applied in world by using a long segment; parent already transformed.
  const v = props.node.value;
  const origin = v.kind === "offsetLine" ? (v as OffsetLine).line.origin : (v as Line).origin;
  const dir = v.kind === "offsetLine" ? (v as OffsetLine).line.direction : (v as Line).direction;
  const span = 40;
  const a = { x: origin.x - dir.x * span, y: origin.y - dir.y * span };
  const b = { x: origin.x + dir.x * span, y: origin.y + dir.y * span };
  const cls = () => [styles.stroke, { [styles.hot]: props.hot }];
  return (
    <>
      <line class={styles.hit} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
      <line class={cls()} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
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
      class={styles.handle}
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
