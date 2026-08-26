import { createMemo } from "solid-js";

import type { TraceNode } from "../../eval/context";
import type { Circle, Line, ParallelLine, Profile, Segment } from "../../geom";
import { edgesSvgPath, profileSvgPath } from "../../geom/profile";
import { infiniteClip, type Camera2, type PaneSize } from "../camera";
import type { Ghost } from "../tool";

import styles from "./View.module.css";

function inkClass(hot: boolean, selected: boolean, editable: boolean) {
  return [
    styles.ink,
    {
      [styles.editable]: editable,
      [styles.hot]: hot && !selected,
      [styles.selected]: selected,
    },
  ];
}

export function Stroke(props: {
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
      {kind() === "line" || kind() === "parallelLine" ? (
        <InfiniteStroke
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

function SegmentStroke(props: { node: TraceNode; hot: boolean; selected: boolean }) {
  const s = () => props.node.value as Segment;
  return (
    <>
      <line class={styles.hit} data-ink={props.node.id} x1={s().a.x} y1={s().a.y} x2={s().b.x} y2={s().b.y} />
      <line class={inkClass(props.hot, props.selected, false)} x1={s().a.x} y1={s().a.y} x2={s().b.x} y2={s().b.y} />
    </>
  );
}

function CircleStroke(props: { node: TraceNode; hot: boolean; selected: boolean }) {
  const c = () => props.node.value as Circle;
  return (
    <>
      <circle class={styles.hit} data-ink={props.node.id} cx={c().center.x} cy={c().center.y} r={Math.abs(c().radius)} />
      <circle
        class={[
          styles.ink,
          {
            [styles.editable]: props.node.editable,
            [styles.hot]: props.hot && !props.selected,
            [styles.selected]: props.selected,
          },
        ]}
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
  camera: Camera2;
  size: PaneSize;
}) {
  const ends = createMemo(() => {
    const v = props.node.value;
    const origin = v.kind === "parallelLine" ? (v as ParallelLine).line.origin : (v as Line).origin;
    const dir = v.kind === "parallelLine" ? (v as ParallelLine).line.direction : (v as Line).direction;
    return infiniteClip(origin, dir, props.camera, props.size);
  });
  return (
    <>
      <line class={styles.hit} data-ink={props.node.id} x1={ends().a.x} y1={ends().a.y} x2={ends().b.x} y2={ends().b.y} />
      <line
        class={inkClass(props.hot, props.selected, props.node.value.kind === "parallelLine" && props.node.editable)}
        x1={ends().a.x}
        y1={ends().a.y}
        x2={ends().b.x}
        y2={ends().b.y}
      />
    </>
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
      data-ink={props.node.id}
      d={d()}
    />
  );
}

export function ProfileGhost(props: { ghost: Extract<Ghost, { kind: "profile" }> }) {
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
    const len = 0.28;
    const n = Math.hypot(a.tx, a.ty) || 1;
    const ux = a.tx / n;
    const uy = a.ty / n;
    const tip = { x: a.at.x + ux * len, y: a.at.y + uy * len };
    const left = { x: a.at.x + ux * len * 0.2 - uy * len * 0.38, y: a.at.y + uy * len * 0.2 + ux * len * 0.38 };
    const right = { x: a.at.x + ux * len * 0.2 + uy * len * 0.38, y: a.at.y + uy * len * 0.2 - ux * len * 0.38 };
    return { tip, left, right, at: a.at };
  });
  return (
    <g pointer-events="none">
      {fill() ? <path class={styles.ghostFill} d={fill()} /> : null}
      {chain() ? <path class={styles.ghost} d={chain()} fill="none" /> : null}
      {arrow() ? (
        <polyline
          class={styles.ghost}
          fill="none"
          points={`${arrow()!.left.x},${arrow()!.left.y} ${arrow()!.tip.x},${arrow()!.tip.y} ${arrow()!.right.x},${arrow()!.right.y}`}
        />
      ) : null}
    </g>
  );
}
