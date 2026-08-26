import { createMemo } from "solid-js";

import { parallelLineValue } from "@/geom/ops";
import { infiniteClip, worldToScreen, type Camera2, type PaneSize } from "../camera";
import type { Ghost } from "../tool";

import styles from "./View.module.css";

const GHOST_POINT_R = 4;
const CORNER_R = 5;
const CORNER_RING_R = 11;

function screenOf(
  world: { x: number; y: number },
  camera: Camera2,
  size: PaneSize,
): { x: number; y: number } {
  return worldToScreen(world, camera, size);
}

function screenEnds(
  ends: { a: { x: number; y: number }; b: { x: number; y: number } },
  camera: Camera2,
  size: PaneSize,
) {
  return { a: screenOf(ends.a, camera, size), b: screenOf(ends.b, camera, size) };
}

export function GhostMark(props: { ghost: Ghost; camera: Camera2; size: PaneSize }) {
  const point = createMemo(() => (props.ghost.kind === "point" ? props.ghost.at : null));
  const corner = createMemo(() => (props.ghost.kind === "corner" ? props.ghost.at : null));
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
    return screenEnds(infiniteClip(g.a, dir, props.camera, props.size), props.camera, props.size);
  });
  const parallelEnds = createMemo(() => {
    const g = parallel();
    if (!g) return null;
    const pl = parallelLineValue(g.geom, g.distance);
    return screenEnds(
      infiniteClip(pl.line.origin, pl.line.direction, props.camera, props.size),
      props.camera,
      props.size,
    );
  });
  const pointPos = createMemo(() => {
    const p = point();
    return p ? screenOf(p, props.camera, props.size) : null;
  });
  const cornerPos = createMemo(() => {
    const p = corner();
    return p ? screenOf(p, props.camera, props.size) : null;
  });
  const circlePos = createMemo(() => {
    const c = circle();
    if (!c) return null;
    return {
      center: screenOf(c.center, props.camera, props.size),
      r: Math.abs(c.radius) * props.camera.scale,
    };
  });
  const segmentEnds = createMemo(() => {
    const s = segment();
    if (!s) return null;
    return screenEnds({ a: s.a, b: s.b }, props.camera, props.size);
  });
  return (
    <g pointer-events="none">
      {cornerPos() ? (
        <>
          <circle class={styles.ghostCornerRing} cx={cornerPos()!.x} cy={cornerPos()!.y} r={CORNER_RING_R} />
          <circle class={styles.ghostCorner} cx={cornerPos()!.x} cy={cornerPos()!.y} r={CORNER_R} />
        </>
      ) : null}
      {pointPos() ? (
        <circle class={styles.ghostPoint} cx={pointPos()!.x} cy={pointPos()!.y} r={GHOST_POINT_R} />
      ) : null}
      {circlePos() ? (
        <>
          <circle
            class={styles.ghostPoint}
            cx={circlePos()!.center.x}
            cy={circlePos()!.center.y}
            r={GHOST_POINT_R}
          />
          <circle
            class={styles.ghost}
            cx={circlePos()!.center.x}
            cy={circlePos()!.center.y}
            r={circlePos()!.r}
            vector-effect="non-scaling-stroke"
          />
        </>
      ) : null}
      {lineEnds() ? (
        <line
          class={styles.ghost}
          x1={lineEnds()!.a.x}
          y1={lineEnds()!.a.y}
          x2={lineEnds()!.b.x}
          y2={lineEnds()!.b.y}
          vector-effect="non-scaling-stroke"
        />
      ) : null}
      {segmentEnds() ? (
        <line
          class={styles.ghost}
          x1={segmentEnds()!.a.x}
          y1={segmentEnds()!.a.y}
          x2={segmentEnds()!.b.x}
          y2={segmentEnds()!.b.y}
          vector-effect="non-scaling-stroke"
        />
      ) : null}
      {parallelEnds() ? (
        <line
          class={styles.ghost}
          x1={parallelEnds()!.a.x}
          y1={parallelEnds()!.a.y}
          x2={parallelEnds()!.b.x}
          y2={parallelEnds()!.b.y}
          vector-effect="non-scaling-stroke"
        />
      ) : null}
    </g>
  );
}
