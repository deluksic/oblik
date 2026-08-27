import { Show, createMemo } from "solid-js";

import type { TraceNode } from "../eval/context";
import type { FigureStyle } from "../eval/paint";
import type { Circle, Line, ParallelLine, Profile, Segment } from "../geom";
import { isGlider } from "../geom/gliders";
import { profileSvgPath } from "../geom/profile";
import { infiniteClip, type Camera2, type PaneSize } from "../euclid2/camera";
import { traceKey } from "../euclid2/pick";

import styles from "./View.module.css";

const ONION: FigureStyle = { kind: "style", stroke: "#8a8478", width: 1.05 };

function dash(s: FigureStyle): string | undefined {
  return s.dash && s.dash.length > 0 ? s.dash.join(" ") : undefined;
}

type StrokeProps = {
  look: FigureStyle;
  onion: boolean;
  hot: boolean;
  selected: boolean;
  muted: boolean;
  camera: Camera2;
  size: PaneSize;
  preview?: boolean;
};

/** `node` is `TraceNode | null` because Solid compiles JSX props as getters — a live preview can go null mid-update. */
export function FigureStroke(props: { node: TraceNode | null } & StrokeProps) {
  return (
    <Show when={props.node} keyed>
      {(node) => (
        <StrokeInk
          node={node}
          look={props.look}
          onion={props.onion}
          hot={props.hot}
          selected={props.selected}
          muted={props.muted}
          camera={props.camera}
          size={props.size}
          preview={props.preview}
        />
      )}
    </Show>
  );
}

function StrokeInk(props: { node: TraceNode } & StrokeProps) {
  const kind = createMemo(() => props.node.value.kind);
  return (
    <g class={{ [styles.preview]: props.preview === true }}>
      {kind() === "segment" ? <Seg node={props.node} look={props.look} onion={props.onion} hot={props.hot} selected={props.selected} muted={props.muted} /> : null}
      {kind() === "line" || kind() === "parallelLine" ? (
        <Inf
          node={props.node}
          look={props.look}
          onion={props.onion}
          hot={props.hot}
          selected={props.selected}
          muted={props.muted}
          camera={props.camera}
          size={props.size}
        />
      ) : null}
      {kind() === "circle" ? (
        <Circ node={props.node} look={props.look} onion={props.onion} hot={props.hot} selected={props.selected} muted={props.muted} />
      ) : null}
      {kind() === "profile" ? (
        <Face node={props.node} look={props.look} onion={props.onion} hot={props.hot} selected={props.selected} muted={props.muted} />
      ) : null}
    </g>
  );
}

function Seg(props: {
  node: TraceNode;
  look: FigureStyle;
  onion: boolean;
  hot: boolean;
  selected: boolean;
  muted: boolean;
}) {
  const s = () => props.node.value as Segment;
  const look = () => (props.onion ? ONION : props.look);
  return (
    <>
      <line
        data-role="hit"
        class={styles.hit}
        data-ink={traceKey(props.node)}
        x1={s().a.x}
        y1={s().a.y}
        x2={s().b.x}
        y2={s().b.y}
      />
      <line
        data-role={props.onion ? "onion" : "paint"}
        class={[styles.stroke, { [styles.hot]: props.hot, [styles.selected]: props.selected, [styles.muted]: props.muted }]}
        fill="none"
        stroke={look().stroke ?? "#1c1917"}
        stroke-width={look().width ?? 1.35}
        stroke-dasharray={dash(look())}
        stroke-linecap="round"
        vector-effect="non-scaling-stroke"
        opacity={props.onion ? 0.4 : 1}
        x1={s().a.x}
        y1={s().a.y}
        x2={s().b.x}
        y2={s().b.y}
      />
    </>
  );
}

function Circ(props: {
  node: TraceNode;
  look: FigureStyle;
  onion: boolean;
  hot: boolean;
  selected: boolean;
  muted: boolean;
}) {
  const c = () => props.node.value as Circle;
  const look = () => (props.onion ? ONION : props.look);
  const fill = () => (props.onion ? "none" : (look().fill ?? "none"));
  return (
    <>
      <circle
        data-role="hit"
        class={styles.hit}
        data-ink={traceKey(props.node)}
        cx={c().center.x}
        cy={c().center.y}
        r={Math.abs(c().radius)}
      />
      <circle
        data-role={props.onion ? "onion" : "paint"}
        class={[styles.stroke, { [styles.hot]: props.hot, [styles.selected]: props.selected, [styles.muted]: props.muted }]}
        fill={fill()}
        stroke={look().stroke ?? "#1c1917"}
        stroke-width={look().width ?? 1.35}
        stroke-dasharray={dash(look())}
        vector-effect="non-scaling-stroke"
        opacity={props.onion ? 0.4 : 1}
        cx={c().center.x}
        cy={c().center.y}
        r={Math.abs(c().radius)}
      />
    </>
  );
}

function Inf(props: {
  node: TraceNode;
  look: FigureStyle;
  onion: boolean;
  hot: boolean;
  selected: boolean;
  muted: boolean;
  camera: Camera2;
  size: PaneSize;
}) {
  const ends = createMemo(() => {
    const v = props.node.value;
    const origin = v.kind === "parallelLine" ? (v as ParallelLine).line.origin : (v as Line).origin;
    const dir = v.kind === "parallelLine" ? (v as ParallelLine).line.direction : (v as Line).direction;
    return infiniteClip(origin, dir, props.camera, props.size);
  });
  const look = () => (props.onion ? ONION : props.look);
  return (
    <>
      <line
        data-role="hit"
        class={styles.hit}
        data-ink={traceKey(props.node)}
        x1={ends().a.x}
        y1={ends().a.y}
        x2={ends().b.x}
        y2={ends().b.y}
      />
      <line
        data-role={props.onion ? "onion" : "paint"}
        class={[styles.stroke, { [styles.hot]: props.hot, [styles.selected]: props.selected, [styles.muted]: props.muted }]}
        fill="none"
        stroke={look().stroke ?? "#1c1917"}
        stroke-width={look().width ?? 1.35}
        stroke-dasharray={dash(look())}
        stroke-linecap="round"
        vector-effect="non-scaling-stroke"
        opacity={props.onion ? 0.4 : 1}
        x1={ends().a.x}
        y1={ends().a.y}
        x2={ends().b.x}
        y2={ends().b.y}
      />
    </>
  );
}

function Face(props: {
  node: TraceNode;
  look: FigureStyle;
  onion: boolean;
  hot: boolean;
  selected: boolean;
  muted: boolean;
}) {
  const d = createMemo(() => profileSvgPath(props.node.value as Profile));
  const look = () => (props.onion ? ONION : props.look);
  const fill = () => (props.onion ? "none" : (look().fill ?? "none"));
  return (
    <>
      <path data-role="hit" class={styles.hitFill} data-ink={traceKey(props.node)} d={d()} />
      <path
        data-role={props.onion ? "onion" : "paint"}
        class={[styles.stroke, { [styles.hot]: props.hot, [styles.selected]: props.selected, [styles.muted]: props.muted }]}
        d={d()}
        fill={fill()}
        stroke={look().stroke ?? "#1c1917"}
        stroke-width={look().width ?? 1.35}
        stroke-dasharray={dash(look())}
        stroke-linecap="round"
        stroke-linejoin="round"
        vector-effect="non-scaling-stroke"
        opacity={props.onion ? 0.35 : 1}
      />
    </>
  );
}

type PointProps = {
  look: FigureStyle | undefined;
  onion: boolean;
  hot: boolean;
  selected: boolean;
  muted: boolean;
  camera: Camera2;
  preview?: boolean;
};

/** Same live-getter contract as `FigureStroke`: `node` may go null while Brush preview unmounts. */
export function FigurePoint(props: { node: TraceNode | null } & PointProps) {
  return (
    <Show when={props.node} keyed>
      {(node) => (
        <PointInk
          node={node}
          look={props.look}
          onion={props.onion}
          hot={props.hot}
          selected={props.selected}
          muted={props.muted}
          camera={props.camera}
          preview={props.preview}
        />
      )}
    </Show>
  );
}

function PointInk(props: { node: TraceNode } & PointProps) {
  const at = createMemo(() => {
    const v = props.node.value;
    if (v.kind === "point") return v;
    if (isGlider(v)) return { x: v.x, y: v.y };
    return { x: 0, y: 0 };
  });
  const mark = () => (props.onion ? "open" : (props.look?.point ?? "dot"));
  const r = () => 5 / Math.max(12, props.camera.scale);
  const stroke = () => (props.onion ? ONION.stroke : (props.look?.stroke ?? "#1c1917"));
  const fill = () => {
    if (props.onion || mark() === "open") return "none";
    const f = props.look?.fill;
    if (!f || f === "none") return stroke();
    return f;
  };
  return (
    <g class={{ [styles.preview]: props.preview === true }}>
      {mark() === "none" && !props.onion ? null : (
        <>
          <circle
            data-role="hit"
            class={styles.hitFill}
            data-ink={traceKey(props.node)}
            cx={at().x}
            cy={at().y}
            r={r() * 2.4}
          />
          <circle
            data-role={props.onion ? "onion" : "paint"}
            class={[styles.point, { [styles.hot]: props.hot, [styles.selected]: props.selected, [styles.muted]: props.muted }]}
            cx={at().x}
            cy={at().y}
            r={r()}
            fill={fill() ?? "none"}
            stroke={stroke()}
            stroke-width={props.look?.width ?? 1.2}
            vector-effect="non-scaling-stroke"
            opacity={props.onion ? 0.45 : 1}
          />
        </>
      )}
    </g>
  );
}
