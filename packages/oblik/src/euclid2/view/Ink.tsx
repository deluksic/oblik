import { Show, createMemo } from "solid-js";

import type { TraceNode } from "@/eval/context";
import type { Circle, Profile, Segment } from "@/geom";
import { infiniteLineAxis } from "@/geom/ops";
import { edgesSvgPath, profileSvgPath } from "@/geom/profile";
import { infiniteClip, type Camera2, type PaneSize } from "../camera";
import { traceKey } from "../pick";
import type { Ghost } from "../tool";

import styles from "./View.module.css";

function inkClass(hot: boolean, selected: boolean, editable: boolean, muted = false) {
  return [
    styles.ink,
    {
      [styles.editable]: editable,
      [styles.hot]: hot && !selected,
      [styles.selected]: selected,
      [styles.muted]: muted && !hot && !selected,
    },
  ];
}

export function Stroke(props: {
  node: TraceNode;
  hot: boolean;
  selected: boolean;
  muted?: boolean;
  camera: Camera2;
  size: PaneSize;
}) {
  const kind = createMemo(() => props.node.value.kind);
  return (
    <>
      {kind() === "segment" ? (
        <SegmentStroke node={props.node} hot={props.hot} selected={props.selected} muted={props.muted} />
      ) : null}
      {kind() === "line" || kind() === "parallelLine" ? (
        <InfiniteStroke
          node={props.node}
          hot={props.hot}
          selected={props.selected}
          muted={props.muted}
          camera={props.camera}
          size={props.size}
        />
      ) : null}
      {kind() === "circle" ? (
        <CircleStroke node={props.node} hot={props.hot} selected={props.selected} muted={props.muted} />
      ) : null}
    </>
  );
}

function SegmentStroke(props: { node: TraceNode; hot: boolean; selected: boolean; muted?: boolean }) {
  const s = () => props.node.value as Segment;
  return (
    <>
      <line class={styles.hit} data-ink={traceKey(props.node)} x1={s().a.x} y1={s().a.y} x2={s().b.x} y2={s().b.y} />
      <line
        class={inkClass(props.hot, props.selected, false, props.muted)}
        x1={s().a.x}
        y1={s().a.y}
        x2={s().b.x}
        y2={s().b.y}
      />
    </>
  );
}

function CircleStroke(props: { node: TraceNode; hot: boolean; selected: boolean; muted?: boolean }) {
  const c = () => props.node.value as Circle;
  return (
    <>
      <circle class={styles.hit} data-ink={traceKey(props.node)} cx={c().center.x} cy={c().center.y} r={Math.abs(c().radius)} />
      <circle
        class={inkClass(props.hot, props.selected, props.node.editable, props.muted)}
        cx={c().center.x}
        cy={c().center.y}
        r={Math.abs(c().radius)}
      />
    </>
  );
}

function InfiniteStroke(props: {
  node: TraceNode;
  hot: boolean;
  selected: boolean;
  muted?: boolean;
  camera: Camera2;
  size: PaneSize;
}) {
  const ends = createMemo(() => {
    const axis = infiniteLineAxis(props.node?.value);
    if (!axis) return null;
    return infiniteClip(axis.origin, axis.dir, props.camera, props.size);
  });
  return (
    <Show when={ends()}>
      {(e) => (
        <>
          <line class={styles.hit} data-ink={traceKey(props.node)} x1={e().a.x} y1={e().a.y} x2={e().b.x} y2={e().b.y} />
          <line
            class={inkClass(
              props.hot,
              props.selected,
              props.node?.value.kind === "parallelLine" && !!props.node.editable,
              props.muted,
            )}
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

export function ProfileFill(props: { node: TraceNode; hot: boolean; selected: boolean }) {
  const d = createMemo(() => profileSvgPath(props.node.value as Profile));
  return (
    <path
      class={[
        styles.fill,
        {
          [styles.fillHot]: props.hot && !props.selected,
          [styles.fillSelected]: props.selected,
        },
      ]}
      data-ink={traceKey(props.node)}
      d={d()}
      stroke="none"
    />
  );
}

export function ProfileOutline(props: { node: TraceNode; hot: boolean; selected: boolean }) {
  const d = createMemo(() => profileSvgPath(props.node.value as Profile));
  return (
    <path
      class={[
        styles.fillOutline,
        {
          [styles.fillOutlineSelected]: props.selected,
          [styles.fillOutlineHidden]: !props.hot && !props.selected,
        },
      ]}
      d={d()}
    />
  );
}

export function ProfileGhost(props: { ghost: Extract<Ghost, { kind: "profile" }>; camera: Camera2 }) {
  const chain = createMemo(() => {
    const g = props.ghost;
    const edges = g.hover ? [...g.edges, g.hover] : g.edges;
    return edgesSvgPath(edges, false);
  });
  const fill = createMemo(() => {
    const g = props.ghost;
    if (g.edges.length < 2) return "";
    return edgesSvgPath(g.edges, true);
  });
  const arrow = createMemo(() => {
    const a = props.ghost.arrow;
    if (!a) return null;
    const n = Math.hypot(a.tx, a.ty) || 1;
    const ux = a.tx / n;
    const uy = a.ty / n;
    const scale = Math.max(8, props.camera.scale);
    const pad = 10 / scale;
    const shaft = 20 / scale;
    const head = 7 / scale;
    const tail = { x: a.at.x + ux * pad, y: a.at.y + uy * pad };
    const tip = { x: tail.x + ux * shaft, y: tail.y + uy * shaft };
    const left = { x: tip.x - ux * head - uy * head * 0.62, y: tip.y - uy * head + ux * head * 0.62 };
    const right = { x: tip.x - ux * head + uy * head * 0.62, y: tip.y - uy * head - ux * head * 0.62 };
    return { tail, tip, left, right };
  });
  return (
    <g pointer-events="none">
      {fill() ? <path class={styles.ghostFill} d={fill()} /> : null}
      {chain() ? <path class={styles.ghost} d={chain()} fill="none" /> : null}
      {arrow() ? (
        <>
          <line
            class={styles.ghostArrow}
            x1={arrow()!.tail.x}
            y1={arrow()!.tail.y}
            x2={arrow()!.tip.x}
            y2={arrow()!.tip.y}
          />
          <polygon
            class={styles.ghostArrowHead}
            points={`${arrow()!.tip.x},${arrow()!.tip.y} ${arrow()!.left.x},${arrow()!.left.y} ${arrow()!.right.x},${arrow()!.right.y}`}
          />
        </>
      ) : null}
    </g>
  );
}
