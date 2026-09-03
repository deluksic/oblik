import { For, createMemo } from "solid-js";

import type { SliderValue, TraceNode } from "@/eval/context";
import { formatNum } from "@/source/patch";

import { traceKey } from "../pick";
import { layoutSliders, type SliderLayout } from "./sliderHud";

import styles from "./View.module.css";

export function NumberSliders(props: {
  nodes: readonly TraceNode[];
  hotId: string | null | undefined;
  selectedKey: string | null | undefined;
}) {
  const layouts = createMemo(() => layoutSliders(props.nodes));
  return (
    <For each={layouts()} keyed={(L) => traceKey(L.node)}>
      {(L) => (
        <SliderMark layout={L()} hotId={props.hotId} selectedKey={props.selectedKey} />
      )}
    </For>
  );
}

function SliderMark(props: {
  layout: SliderLayout;
  hotId: string | null | undefined;
  selectedKey: string | null | undefined;
}) {
  const node = () => props.layout.node;
  const slider = () => node().value as SliderValue;
  const hot = () => props.hotId === node().id;
  const selected = () => props.selectedKey?.startsWith(`${node().id}:`) ?? false;
  return (
    <g
      class={styles.sliderPanel}
      data-slider={traceKey(node())}
      transform={`translate(${props.layout.panel.x} ${props.layout.panel.y})`}
    >
      <rect
        class={[
          styles.sliderBg,
          { [styles.sliderHot]: hot() && !selected(), [styles.sliderSelected]: selected() },
        ]}
        width={props.layout.panel.w}
        height={props.layout.panel.h}
        rx={8}
      />
      <text class={styles.sliderLabel} x={14} y={18}>
        {node().bind ?? "value"}
      </text>
      <text class={styles.sliderValue} x={props.layout.panel.w - 14} y={18} text-anchor="end">
        {formatNum(slider().n)}
      </text>
      <rect
        class={styles.sliderTrack}
        x={14}
        y={32}
        width={props.layout.panel.w - 28}
        height={6}
        rx={3}
      />
      <circle class={styles.sliderKnob} cx={props.layout.knobX - props.layout.panel.x} cy={35} r={7} />
    </g>
  );
}
