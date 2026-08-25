import { createMemo } from "solid-js";

import type { TraceNode } from "../../eval/context";
import type { Circle, Line, OffsetLine, Segment } from "../../geom";
import { infiniteClip, type Camera2, type PaneSize } from "../camera";

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
      {kind() === "line" || kind() === "offsetLine" ? (
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
      <line class={styles.hit} x1={s().a.x} y1={s().a.y} x2={s().b.x} y2={s().b.y} />
      <line class={inkClass(props.hot, props.selected, false)} x1={s().a.x} y1={s().a.y} x2={s().b.x} y2={s().b.y} />
    </>
  );
}

function CircleStroke(props: { node: TraceNode; hot: boolean; selected: boolean }) {
  const c = () => props.node.value as Circle;
  return (
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
    const origin = v.kind === "offsetLine" ? (v as OffsetLine).line.origin : (v as Line).origin;
    const dir = v.kind === "offsetLine" ? (v as OffsetLine).line.direction : (v as Line).direction;
    return infiniteClip(origin, dir, props.camera, props.size);
  });
  return (
    <>
      <line class={styles.hit} x1={ends().a.x} y1={ends().a.y} x2={ends().b.x} y2={ends().b.y} />
      <line
        class={inkClass(props.hot, props.selected, props.node.value.kind === "offsetLine" && props.node.editable)}
        x1={ends().a.x}
        y1={ends().a.y}
        x2={ends().b.x}
        y2={ends().b.y}
      />
    </>
  );
}
