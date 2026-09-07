import { For, createMemo } from "solid-js";

import type { TraceNode } from "#eval/context";
import { isFillGeom } from "#geom/csg2";

import type { Camera2, PaneSize } from "../camera";
import { traceKey } from "../pick";
import type { Ghost } from "../tool";
import { RegionFill, Stroke } from "./Ink";

import styles from "./TraceGhost.module.css";

/**
 * Muted render pass for a registered tool's draft-evaluated trace (the ghost).
 *
 * The fn body's constructors carry stamped ids that are *shared by every call*
 * of that tool, so ghost nodes are re-ids with a per-draft namespace before
 * rendering. That keeps list keys and the fill masks' `uid`s unique against the
 * live tape (and between consecutive ghosts) — a second placement of the same
 * tool must still preview. No hit chrome, no handles: the group swallows no
 * pointer events.
 */
function reId(node: TraceNode, stamp: string): TraceNode {
  return node.id.startsWith(stamp) ? node : { ...node, id: `${stamp}::${node.id}` };
}

export function TraceGhost(props: {
  ghost: Extract<Ghost, { kind: "trace" }>;
  camera: Camera2;
  size: PaneSize;
}) {
  const nodes = createMemo(() => props.ghost.nodes.map((n) => reId(n, props.ghost.stamp)), {
    equals: (a, b) => a.length === b.length && a.every((n, i) => n === b[i]),
  });
  const fills = createMemo(() => nodes().filter((n) => isFillGeom(n.value)));
  const ink = createMemo(() =>
    nodes().filter((n) => !isFillGeom(n.value) && n.kind !== "point" && n.kind !== "slider"),
  );
  return (
    <g class={styles.band} pointer-events="none">
      <For each={fills()} keyed={(n: TraceNode) => `gh-fill-${traceKey(n)}`}>
        {(n) => <RegionFill node={n()} hot={false} selected={false} />}
      </For>
      <For each={ink()} keyed={(n: TraceNode) => `gh-ink-${traceKey(n)}`}>
        {(n) => (
          <Stroke
            node={n()}
            hot={false}
            selected={false}
            muted
            camera={props.camera}
            size={props.size}
          />
        )}
      </For>
    </g>
  );
}
