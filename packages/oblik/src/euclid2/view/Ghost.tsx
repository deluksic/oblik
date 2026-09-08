import { For, createMemo } from "solid-js";

import { parallelLineValue } from "#geom/ops";

import { infiniteClip, worldToScreen, type Camera2, type PaneSize } from "../camera";
import type { Ghost } from "../tool";

import styles from "./View.module.css";

const { abs, sqrt } = Math;
const GHOST_POINT_R = 4;
const CORNER_R = 5;
const CORNER_RING_R = 11;

type Screen = { x: number; y: number };

function screenOf(world: { x: number; y: number }, camera: Camera2, size: PaneSize): Screen {
  return worldToScreen(world, camera, size);
}

function screenEnds(a: { x: number; y: number }, b: { x: number; y: number }, camera: Camera2, size: PaneSize) {
  return { a: screenOf(a, camera, size), b: screenOf(b, camera, size) };
}

/** Pane-clipped ends of the infinite line through `a` and `b`. */
function infiniteEnds(
  a: { x: number; y: number },
  b: { x: number; y: number },
  camera: Camera2,
  size: PaneSize,
) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = sqrt(dx * dx + dy * dy);
  const dir = len < 1e-9 ? { x: 1, y: 0 } : { x: dx / len, y: dy / len };
  const ends = infiniteClip(a, dir, camera, size);
  return screenEnds(ends.a, ends.b, camera, size);
}

function strokeEl(ends: { a: Screen; b: Screen }) {
  return (
    <line
      class={styles.ghost}
      x1={ends.a.x}
      y1={ends.a.y}
      x2={ends.b.x}
      y2={ends.b.y}
      vector-effect="non-scaling-stroke"
    />
  );
}

export function GhostMark(props: { ghost: Ghost; camera: Camera2; size: PaneSize }) {
  const mark = createMemo(() => {
    const g = props.ghost;
    const { camera, size } = props;
    switch (g.kind) {
      case "point": {
        const p = screenOf(g.at, camera, size);
        return <circle class={styles.ghostPoint} cx={p.x} cy={p.y} r={GHOST_POINT_R} />;
      }
      case "corner": {
        const p = screenOf(g.at, camera, size);
        return (
          <>
            <circle class={styles.ghostCornerRing} cx={p.x} cy={p.y} r={CORNER_RING_R} />
            <circle class={styles.ghostCorner} cx={p.x} cy={p.y} r={CORNER_R} />
          </>
        );
      }
      case "circle": {
        const c = screenOf(g.center, camera, size);
        const r = abs(g.radius) * camera.scale;
        return (
          <>
            <circle class={styles.ghostPoint} cx={c.x} cy={c.y} r={GHOST_POINT_R} />
            <circle
              class={styles.ghost}
              cx={c.x}
              cy={c.y}
              r={r}
              vector-effect="non-scaling-stroke"
            />
          </>
        );
      }
      case "line":
        return strokeEl(infiniteEnds(g.a, g.b, camera, size));
      case "segment":
        return strokeEl(screenEnds(g.a, g.b, camera, size));
      case "parallelLine": {
        const pl = parallelLineValue(g.geom, g.distance);
        return strokeEl(infiniteEnds(pl.line.origin, pl.line.direction, camera, size));
      }
      case "tangent":
        return (
          <For
            each={g.strokes.map((s, i) => ({
              ends: infiniteEnds(s.a, s.b, camera, size),
              chosen: i === g.chosen,
            }))}
          >
            {(t) => (
              <line
                class={styles.ghost}
                style={t.chosen ? undefined : { opacity: 0.3 }}
                x1={t.ends.a.x}
                y1={t.ends.a.y}
                x2={t.ends.b.x}
                y2={t.ends.b.y}
                vector-effect="non-scaling-stroke"
              />
            )}
          </For>
        );
      // region / trace ghosts are rendered by their own marks
      default:
        return undefined;
    }
  });
  return <g pointer-events="none">{mark()}</g>;
}
