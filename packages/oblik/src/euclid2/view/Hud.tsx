import { For, createMemo } from "solid-js";

import type { TraceNode } from "@/eval/context";
import { gliderAt, isGlider } from "@/geom/gliders";
import type { Point } from "@/geom";
import { worldToScreen, type Camera2, type PaneSize } from "../camera";
import { isCrossing, type PlacePoint } from "../place";
import { traceKey } from "../pick";
import { POINT_STROKE_PX, chromeLayers, layerStrokeWidth } from "./chrome";
import { readChromeMetrics } from "./chrome-metrics";
import { HANDLE_R, SNAP_R, pointMarkRadius } from "./pointMark";

import styles from "./View.module.css";

export function PointMark(props: {
  node: TraceNode;
  size: PaneSize;
  camera: Camera2;
  hot: boolean;
  selected: boolean;
  muted?: boolean;
  overlay?: boolean;
  knockout?: boolean;
}) {
  const pos = createMemo(() => {
    const v = props.node.value;
    const at = v.kind === "point" ? (v as Point) : isGlider(v) ? gliderAt(v) : { x: 0, y: 0 };
    return worldToScreen(at, props.camera, props.size);
  });
  const layers = createMemo(() =>
    chromeLayers(POINT_STROKE_PX, {
      selected: props.selected,
      hover: props.hot && !props.selected,
      overlay: props.overlay === true,
      knockout: props.knockout !== false,
      screenSpace: true,
      point: true,
    }, readChromeMetrics()),
  );
  return (
    <>
      <For each={layers()}>
        {(layer) => (
          <circle
            class={
              layer.kind === "knockout"
                ? styles.knockout
                : layer.kind === "outline"
                  ? styles.outline
                  : [
                      styles.point,
                      {
                        [styles.editable]: props.node.editable && !props.selected && !props.hot,
                        [styles.selected]: props.selected || props.hot,
                        [styles.muted]: !!props.muted && !props.hot && !props.selected,
                      },
                    ]
            }
            opacity={layer.opacity}
            cx={pos().x}
            cy={pos().y}
            r={pointMarkRadius(props.node.editable)}
            fill={layer.kind === "paint" ? undefined : "none"}
            stroke-width={layerStrokeWidth(layer)}
          />
        )}
      </For>
      {props.overlay || !props.node.bind ? null : (
        <text
          class={[styles.label, { [styles.muted]: !!props.muted && !props.hot && !props.selected }]}
          x={pos().x + 10}
          y={pos().y - 8}
          font-size="12"
        >
          {props.node.bind}
        </text>
      )}
    </>
  );
}

export function Handle(props: {
  node: TraceNode;
  size: PaneSize;
  camera: Camera2;
  hot: boolean;
  selected: boolean;
  muted?: boolean;
}) {
  const pos = createMemo(() => {
    const v = props.node.value;
    const at = v.kind === "point" ? (v as Point) : isGlider(v) ? gliderAt(v) : { x: 0, y: 0 };
    return worldToScreen(at, props.camera, props.size);
  });
  return (
    <circle
      class={styles.handle}
      data-handle={traceKey(props.node)}
      data-kind="point"
      cx={pos().x}
      cy={pos().y}
      r={HANDLE_R}
    />
  );
}

export function PlaceSnap(props: { point: PlacePoint; camera: Camera2; size: PaneSize }) {
  const pos = createMemo(() => worldToScreen(props.point.at, props.camera, props.size));
  const crossing = () => isCrossing(props.point);
  return (
    <g pointer-events="none">
      {crossing() ? (
        <polygon
          class={styles.snapDiamond}
          points={`${pos().x},${pos().y - SNAP_R} ${pos().x + SNAP_R},${pos().y} ${pos().x},${pos().y + SNAP_R} ${pos().x - SNAP_R},${pos().y}`}
        />
      ) : (
        <circle class={styles.snapPoint} cx={pos().x} cy={pos().y} r={SNAP_R - 2} />
      )}
    </g>
  );
}
