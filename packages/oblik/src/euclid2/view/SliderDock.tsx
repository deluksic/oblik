import { For, createSignal } from "solid-js";

import type { SliderValue, TraceNode } from "#eval/context";
import { formatNum } from "#source/patch";

import { movedPastClick, traceKey } from "../pick";
import {
  setSliderDockScrollTop,
  SLIDER_MARGIN,
  SLIDER_PANEL_H,
  SLIDER_PANEL_W,
  snapEditNumber,
} from "./sliderHud";

import styles from "./SliderDock.module.css";

const { max, min, round } = Math;

export type SliderDockProps = {
  nodes: readonly TraceNode[];
  placing?: boolean;
  hotId?: string | undefined;
  selectedKey?: string | undefined;
  onHoverId?: (id: string | undefined) => void;
  onPick?: (hits: TraceNode[]) => void;
  onDraft?: (id: string, values: number[]) => void;
  onCommit?: (id: string, values: number[]) => void;
  /** True while a slider drag has produced a draft; false on release/cancel. */
  onLiveEdit?: (live: boolean) => void;
};

/** HTML slider HUD shared by the SVG and WebGPU panes: a left-edge column of
 * value panels that scrolls when it outgrows the pane. Each panel edits its
 * slider with the same click/drag semantics as the classic canvas handles
 * (live draft while dragging, literal commit on release, click picks). */
export function SliderDock(props: SliderDockProps) {
  // Writable memos over the pane state: <For> memoizes rows on list identity,
  // so hover/selection/placing must reach each row through these signals (read
  // via the per-row getters below) rather than through props captured at map
  // time.
  const [hotId] = createSignal(() => props.hotId);
  const [selectedKey] = createSignal(() => props.selectedKey);
  const [placing] = createSignal(() => props.placing ?? false);

  function hoverAt(clientX: number, clientY: number) {
    const el = document.elementFromPoint(clientX, clientY);
    const attr = (el as Element | null)?.closest?.("[data-slider]")?.getAttribute("data-slider");
    const node = attr ? props.nodes.find((n) => traceKey(n) === attr) : undefined;
    props.onHoverId?.(node ? node.id : undefined);
  }

  return (
    <div
      class={styles.dock}
      data-slider-hud
      // Anchored at 0,0; the padding (--space-3 == SLIDER_MARGIN) gives the
      // panels room for their box-shadows inside the scrollable container so
      // outlines are never clipped. Width = panel + both paddings.
      style={{ width: `${SLIDER_PANEL_W + SLIDER_MARGIN * 2}px` }}
      onScroll={(e) => setSliderDockScrollTop((e.currentTarget).scrollTop)}
      onWheel={(e) => {
        const el = e.currentTarget;
        // Let a scrollable list take the wheel; otherwise it falls through to
        // the pane's wheel-to-zoom handler.
        if (el.scrollHeight > el.clientHeight) e.stopPropagation();
      }}
    >
      <For each={props.nodes} keyed={(n) => traceKey(n)}>
        {(node) => (
          <SliderRow
            node={node}
            hot={() => hotId() === node().id}
            selected={() => selectedKey()?.startsWith(`${node().id}:`) ?? false}
            placing={() => placing()}
            onHoverId={props.onHoverId}
            onPick={props.onPick}
            onDraft={props.onDraft}
            onCommit={props.onCommit}
            onLiveEdit={props.onLiveEdit}
            onHoverAt={hoverAt}
          />
        )}
      </For>
    </div>
  );
}

function SliderRow(props: {
  node: () => TraceNode;
  hot: () => boolean;
  selected: () => boolean;
  placing: () => boolean;
  onHoverId?: (id: string | undefined) => void;
  onPick?: (hits: TraceNode[]) => void;
  onDraft?: (id: string, values: number[]) => void;
  onCommit?: (id: string, values: number[]) => void;
  onLiveEdit?: (live: boolean) => void;
  onHoverAt: (clientX: number, clientY: number) => void;
}) {
  const slider = (): SliderValue => props.node().value as SliderValue;
  const [dragging, setDragging] = createSignal(false);

  let trackEl: HTMLDivElement | undefined;
  let downX = 0;
  let downY = 0;
  let live = false;

  const frac = () => {
    const g = slider();
    const span = max(1e-9, g.max - g.min);
    return min(1, max(0, (g.n - g.min) / span));
  };

  /** Value at a client-X against this panel's track (same mapping as the SVG
   * HUD: track x range → min..max, snapped to step, rounded to 2 decimals). */
  function valueAt(clientX: number): number {
    const rect = trackEl?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return slider().n;
    const t = min(1, max(0, (clientX - rect.left) / rect.width));
    const g = slider();
    const raw = g.min + t * (g.max - g.min);
    return round(snapEditNumber(raw, g.min, g.max, g.step) * 100) / 100;
  }

  function begin(e: PointerEvent) {
    if (props.placing() || e.button !== 0) return;
    downX = e.clientX;
    downY = e.clientY;
    live = false;
    setDragging(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function move(e: PointerEvent) {
    if (!dragging()) return;
    // The 2px dead zone absorbs pointer jitter before drafts start; click-vs-
    // drag is decided at release by total travel (parity with canvas handles).
    const dx = e.clientX - downX;
    const dy = e.clientY - downY;
    if (dx * dx + dy * dy < 4) return;
    if (!live) {
      live = true;
      props.onLiveEdit?.(true);
    }
    props.onDraft?.(props.node().id, [valueAt(e.clientX)]);
  }

  function end(e: PointerEvent) {
    if (!dragging()) return;
    setDragging(false);
    if (live) props.onLiveEdit?.(false);
    if (e.type !== "pointerup") {
      props.onHoverAt(e.clientX, e.clientY);
      return;
    }
    if (!movedPastClick(downX, downY, e.clientX, e.clientY)) {
      props.onPick?.([props.node()]);
    } else {
      props.onCommit?.(props.node().id, [valueAt(e.clientX)]);
    }
    props.onHoverAt(e.clientX, e.clientY);
  }

  return (
    <div
      class={[
        styles.panel,
        dragging() ? styles.dragging : undefined,
        props.hot() && !props.selected() && !dragging() ? styles.hot : undefined,
        props.selected() ? styles.selected : undefined,
      ]}
      data-slider={traceKey(props.node())}
      style={{ height: `${SLIDER_PANEL_H}px` }}
      onPointerDown={begin}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onPointerEnter={() => {
        if (!props.placing() && !dragging()) props.onHoverId?.(props.node().id);
      }}
      onPointerLeave={() => {
        if (!props.placing() && !dragging()) props.onHoverId?.(undefined);
      }}
    >
      <div class={styles.head}>
        <span class={styles.label}>{props.node().bind ?? "value"}</span>
        <span class={styles.value}>{formatNum(slider().n)}</span>
      </div>
      <div class={styles.track} ref={(el) => (trackEl = el)}>
        <span class={styles.rail} />
        <span class={styles.fill} style={{ width: `${frac() * 100}%` }} />
        <span class={styles.knob} style={{ left: `${frac() * 100}%` }}>
          <span class={styles.knobDot} />
        </span>
      </div>
    </div>
  );
}
