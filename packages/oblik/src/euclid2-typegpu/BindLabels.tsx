import { For, createMemo } from "solid-js";

import type { TraceNode } from "#eval/context";

import { worldToScreen, type Camera2, type PaneSize } from "../euclid2/camera";
import { traceKey } from "../euclid2/pick";
import { mutedForScope, type Scope } from "../euclid2/tool";
import { isHot } from "../euclid2/view/marks";
import { isBindLabelNode, labelAnchor, labelBoxAt } from "./labelPlacement";

import styles from "./BindLabels.module.css";

export type BindLabelsProps = {
  trace: TraceNode[];
  camera: Camera2;
  size: PaneSize;
  hoverId?: string | undefined;
  selectedKey?: string | undefined;
  /** Mute for the point band — mirrors the SVG view's `chrome().mutePoints`. */
  mutePoints?: boolean;
  scope?: Scope | undefined;
};

/** Bind labels for the WebGPU view. In the SVG view a label is a `<text>` inside
 * the point band; here it is HTML positioned over the canvas from the same
 * `worldToScreen` mapping (see `docs/prototypes/12.md` — text is never SVG or
 * GPU glyphs). Camera and pane are reactive props, so pan/zoom repositions the
 * labels on the same tick the painter redraws. */
export function BindLabels(props: BindLabelsProps) {
  const labels = createMemo(() => props.trace.filter(isBindLabelNode));
  const muted = (n: TraceNode) =>
    props.mutePoints === true || (props.scope !== undefined && mutedForScope(n, props.scope));
  return (
    <div class={styles.layer}>
      <For each={labels()} keyed={traceKey}>
        {(n) => (
          <BindLabel
            node={n()}
            camera={props.camera}
            size={props.size}
            muted={muted(n())}
            hot={isHot(n(), props.hoverId, props.selectedKey)}
          />
        )}
      </For>
    </div>
  );
}

function BindLabel(props: {
  node: TraceNode;
  camera: Camera2;
  size: PaneSize;
  muted: boolean;
  hot: boolean;
}) {
  const shift = createMemo(() => {
    const at = labelAnchor(props.node);
    if (!at) return undefined;
    const box = labelBoxAt(worldToScreen(at, props.camera, props.size));
    return `translate(${box.x}px, ${box.y}px)`;
  });
  return (
    <span
      class={[styles.label, { [styles.muted]: props.muted && !props.hot }]}
      style={{ transform: shift() }}
    >
      {props.node.bind}
    </span>
  );
}
