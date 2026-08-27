import { Show, createMemo } from "solid-js";

import type { TraceNode } from "../eval/context";
import type { FigureStyle } from "../eval/paint";
import { infiniteLineAxis } from "../geom/ops";
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
      <Show when={kind() === "segment"}>
        <Seg node={props.node} look={props.look} onion={props.onion} hot={props.hot} selected={props.selected} muted={props.muted} />
      </Show>
      <Show when={kind() === "line" || kind() === "parallelLine"}>
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
      </Show>
      <Show when={kind() === "circle"}>
        <Circ node={props.node} look={props.look} onion={props.onion} hot={props.hot} selected={props.selected} muted={props.muted} />
      </Show>
      <Show when={kind() === "profile"}>
        <Face node={props.node} look={props.look} onion={props.onion} hot={props.hot} selected={props.selected} muted={props.muted} />
      </Show>
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
  const s = createMemo(() => {
    const v = props.node?.value;
    return v?.kind === "segment" ? v : null;
  });
  const look = () => (props.onion ? ONION : props.look);
  return (
    <Show when={s()}>
      {(seg) => (
        <>
          <line
            data-role="hit"
            class={styles.hit}
            data-ink={traceKey(props.node)}
            x1={seg().a.x}
            y1={seg().a.y}
            x2={seg().b.x}
            y2={seg().b.y}
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
            x1={seg().a.x}
            y1={seg().a.y}
            x2={seg().b.x}
            y2={seg().b.y}
          />
        </>
      )}
    </Show>
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
  const c = createMemo(() => {
    const v = props.node?.value;
    return v?.kind === "circle" ? v : null;
  });
  const look = () => (props.onion ? ONION : props.look);
  const fill = () => (props.onion ? "none" : (look().fill ?? "none"));
  return (
    <Show when={c()}>
      {(circ) => (
        <>
          <circle
            data-role="hit"
            class={styles.hit}
            data-ink={traceKey(props.node)}
            cx={circ().center.x}
            cy={circ().center.y}
            r={Math.abs(circ().radius)}
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
            cx={circ().center.x}
            cy={circ().center.y}
            r={Math.abs(circ().radius)}
          />
        </>
      )}
    </Show>
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
    const axis = infiniteLineAxis(props.node?.value);
    if (!axis) return null;
    return infiniteClip(axis.origin, axis.dir, props.camera, props.size);
  });
  const look = () => (props.onion ? ONION : props.look);
  return (
    <Show when={ends()}>
      {(e) => (
        <>
          <line
            data-role="hit"
            class={styles.hit}
            data-ink={traceKey(props.node)}
            x1={e().a.x}
            y1={e().a.y}
            x2={e().b.x}
            y2={e().b.y}
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
            x1={e().a.x}
            y1={e().a.y}
            x2={e().b.x}
            y2={e().b.y}
          />
        </>
      )}
    </Show>
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
  const d = createMemo(() => {
    const v = props.node?.value;
    return v?.kind === "profile" ? profileSvgPath(v) : null;
  });
  const look = () => (props.onion ? ONION : props.look);
  const fill = () => (props.onion ? "none" : (look().fill ?? "none"));
  return (
    <Show when={d()}>
      {(path) => (
        <>
          <path data-role="hit" class={styles.hitFill} data-ink={traceKey(props.node)} d={path()} />
          <path
            data-role={props.onion ? "onion" : "paint"}
            class={[styles.stroke, { [styles.hot]: props.hot, [styles.selected]: props.selected, [styles.muted]: props.muted }]}
            d={path()}
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
      )}
    </Show>
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
    const v = props.node?.value;
    if (v?.kind === "point") return v;
    if (v && isGlider(v)) return { x: v.x, y: v.y };
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
