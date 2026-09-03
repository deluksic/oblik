import { For, createMemo } from "solid-js";

import type { Camera2, PaneSize } from "../camera";

import styles from "./View.module.css";


const { ceil, floor } = Math;
export function Grid(props: { camera: Camera2; size: PaneSize }) {
  const ticks = createMemo(() => {
    const cam = props.camera;
    const size = props.size;
    const halfH = size.h / 2 / cam.scale + 1;
    const halfW = size.w / 2 / cam.scale + 1;
    const x0 = floor(cam.x - halfW);
    const x1 = ceil(cam.x + halfW);
    const y0 = floor(cam.y - halfH);
    const y1 = ceil(cam.y + halfH);
    const xs: number[] = [];
    const ys: number[] = [];
    for (let x = x0; x <= x1; x++) xs.push(x);
    for (let y = y0; y <= y1; y++) ys.push(y);
    return { xs, ys, x0, x1, y0, y1 };
  });
  return (
    <g pointer-events="none">
      <For each={ticks().xs}>
        {(x) => (
          <line
            class={[styles.grid, { [styles.axis]: x === 0 }]}
            x1={x}
            y1={ticks().y0}
            x2={x}
            y2={ticks().y1}
          />
        )}
      </For>
      <For each={ticks().ys}>
        {(y) => (
          <line
            class={[styles.grid, { [styles.axis]: y === 0 }]}
            x1={ticks().x0}
            y1={y}
            x2={ticks().x1}
            y2={y}
          />
        )}
      </For>
    </g>
  );
}
