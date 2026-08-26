import { createMemo } from "solid-js";

import type { TraceNode } from "@/eval/context";
import { formatNum } from "@/source/patch";
import { layoutSliders } from "./sliderHud";

import styles from "./View.module.css";

export function NumberSliders(props: {
  nodes: readonly TraceNode[];
  hotId: string | null | undefined;
  selectedKey: string | null | undefined;
}) {
  const layouts = createMemo(() => layoutSliders(props.nodes));
  return (
    <>
      {layouts().map((L) => {
        const g = L.node.value;
        if (g.kind !== "slider") return null;
        const hot = props.hotId === L.node.id;
        const selected = props.selectedKey?.startsWith(`${L.node.id}:`) ?? false;
        return (
          <g
            class={styles.sliderPanel}
            data-slider={L.node.id}
            transform={`translate(${L.panel.x} ${L.panel.y})`}
          >
            <rect
              class={[styles.sliderBg, { [styles.sliderHot]: hot && !selected, [styles.sliderSelected]: selected }]}
              width={L.panel.w}
              height={L.panel.h}
              rx={8}
            />
            <text class={styles.sliderLabel} x={14} y={18}>
              {L.node.bind ?? "value"}
            </text>
            <text class={styles.sliderValue} x={L.panel.w - 14} y={18} text-anchor="end">
              {formatNum(g.n)}
            </text>
            <rect class={styles.sliderTrack} x={14} y={32} width={L.panel.w - 28} height={6} rx={3} />
            <circle class={styles.sliderKnob} cx={L.knobX - L.panel.x} cy={35} r={7} />
          </g>
        );
      })}
    </>
  );
}
