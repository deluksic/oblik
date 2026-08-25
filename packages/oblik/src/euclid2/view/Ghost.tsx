import { createMemo } from "solid-js";

import { parallelLineValue } from "../../geom/ops";
import { infiniteClip, type Camera2, type PaneSize } from "../camera";
import type { Ghost } from "../tool";

import styles from "./View.module.css";

export function GhostMark(props: { ghost: Ghost; camera: Camera2; size: PaneSize }) {
  const point = createMemo(() => (props.ghost.kind === "point" ? props.ghost.at : null));
  const circle = createMemo(() => (props.ghost.kind === "circle" ? props.ghost : null));
  const line = createMemo(() => (props.ghost.kind === "line" ? props.ghost : null));
  const segment = createMemo(() => (props.ghost.kind === "segment" ? props.ghost : null));
  const parallel = createMemo(() => (props.ghost.kind === "parallelLine" ? props.ghost : null));
  const lineEnds = createMemo(() => {
    const g = line();
    if (!g) return null;
    const dx = g.b.x - g.a.x;
    const dy = g.b.y - g.a.y;
    const len = Math.hypot(dx, dy);
    const dir = len < 1e-9 ? { x: 1, y: 0 } : { x: dx / len, y: dy / len };
    return infiniteClip(g.a, dir, props.camera, props.size);
  });
  const parallelEnds = createMemo(() => {
    const g = parallel();
    if (!g) return null;
    const pl = parallelLineValue(g.geom, g.distance);
    return infiniteClip(pl.line.origin, pl.line.direction, props.camera, props.size);
  });
  return (
    <>
      {point() ? <circle class={styles.ghostPoint} cx={point()!.x} cy={point()!.y} r={0.08} /> : null}
      {circle() ? (
        <>
          <circle class={styles.ghostPoint} cx={circle()!.center.x} cy={circle()!.center.y} r={0.08} />
          <circle
            class={styles.ghost}
            cx={circle()!.center.x}
            cy={circle()!.center.y}
            r={Math.abs(circle()!.radius)}
          />
        </>
      ) : null}
      {lineEnds() ? (
        <line class={styles.ghost} x1={lineEnds()!.a.x} y1={lineEnds()!.a.y} x2={lineEnds()!.b.x} y2={lineEnds()!.b.y} />
      ) : null}
      {segment() ? (
        <line class={styles.ghost} x1={segment()!.a.x} y1={segment()!.a.y} x2={segment()!.b.x} y2={segment()!.b.y} />
      ) : null}
      {parallelEnds() ? (
        <line
          class={styles.ghost}
          x1={parallelEnds()!.a.x}
          y1={parallelEnds()!.a.y}
          x2={parallelEnds()!.b.x}
          y2={parallelEnds()!.b.y}
        />
      ) : null}
    </>
  );
}
