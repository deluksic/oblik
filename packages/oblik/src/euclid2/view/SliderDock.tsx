import { For, createSignal, onCleanup } from "solid-js";

import type { SliderValue, TraceNode } from "#eval/context";
import { formatNum } from "#source/patch";

import { traceKey } from "../pick";
import { createDragHandler } from "./createDragHandler";
import { setSliderDockScrollTop, SLIDER_MARGIN, SLIDER_PANEL_H, SLIDER_PANEL_W } from "./sliderHud";

import styles from "./SliderDock.module.css";

const { max, min } = Math;

/** Distance the pointer must travel before a press stops meaning "select this
 * slider". The value itself is the range input's business — the pane only needs
 * to know whether the gesture was a pick or a drag of the thumb. */
const SLIDER_DEAD_ZONE_PX = 2;
/** A native `<input type="range">` refuses `step="0"`; an unstepped slider gets
 * the browser's `any` so it can still land between its neighbours. */
const STEP_ANY = "any";

export type SliderDockProps = {
  nodes: readonly TraceNode[];
  placing?: boolean;
  hotKey?: string | undefined;
  selectedKey?: string | undefined;
  onHoverKey?: (key: string | undefined) => void;
  onPick?: (hits: TraceNode[]) => void;
  onDraft?: (id: string, values: number[]) => void;
  onCommit?: (id: string, values: number[]) => void;
  /** True while a slider drag has produced a draft; false on release/cancel. */
  onLiveEdit?: (live: boolean) => void;
};

/** HTML slider HUD shared by the SVG and WebGPU panes: a left-edge column of
 * value panels that scrolls when it outgrows the pane.
 *
 * Each panel is a real `<input type="range">`, so focus, arrow keys,
 * Home/End/PageUp/PageDown, `role="slider"` and the ARIA value wiring come from
 * the platform instead of being reimplemented. The pane layers on top only what
 * a range input has no notion of: a live draft while it is being moved, one
 * literal write when the gesture ends, and a stationary press picking the
 * slider's node. */
export function SliderDock(props: SliderDockProps) {
  // Writable memos over the pane state: <For> memoizes rows on list identity,
  // so hover/selection/placing must reach each row through these signals (read
  // via the per-row getters below) rather than through props captured at map
  // time.
  const [hotKey] = createSignal(() => props.hotKey);
  const [selectedKey] = createSignal(() => props.selectedKey);
  const [placing] = createSignal(() => props.placing ?? false);
  /** `id:occ` of the slider being edited, so its panel can render the dragging
   * state without every row owning a gesture. */
  const [liveKey, setLiveKey] = createSignal<string | undefined>(undefined);

  let live = false;
  /** The value the range last reported, held between `input` and the write.
   * Also the "is there anything to write" latch: `commit` clears it, so the two
   * paths that can end a gesture cannot write the same value twice. */
  let last: { id: string; value: number } | undefined;

  // Only the pick verdict is ours: the range input runs its own gesture, and
  // keeps its own pointer capture, for the value. This handler exists so a
  // release can ask whether the pointer ever moved — exactly the question a
  // value cannot answer, since a press that jumps the thumb somewhere is still
  // a pick. `dragged` latches off the same radius, so a press that twitches by
  // a pixel still picks.
  const drag = createDragHandler({
    preventDefault: false,
    deadZoneRadius: SLIDER_DEAD_ZONE_PX,
  });

  function announce(liveNext: boolean) {
    if (live === liveNext) return;
    live = liveNext;
    props.onLiveEdit?.(liveNext);
  }

  /** Write the pending value, once. Reached from the range's `change` (pointer
   * release, arrow key, Enter, blur) and, for pointer gestures, from our own
   * session's end. */
  function commit() {
    const pending = last;
    if (!pending) return;
    last = undefined;
    setLiveKey(undefined);
    announce(false);
    props.onCommit?.(pending.id, [pending.value]);
  }

  /** Where the pointer is: `elementFromPoint` is current mid-gesture in a way a
   * cached `pointerenter` target is not, since a panel can be replaced under a
   * stationary pointer. */
  function hoverAt(clientX: number, clientY: number) {
    const el = document.elementFromPoint(clientX, clientY);
    const attr =
      (el as Element | null)?.closest?.("[data-slider]")?.getAttribute("data-slider") ?? undefined;
    const key = attr && props.nodes.some((n) => traceKey(n) === attr) ? attr : undefined;
    props.onHoverKey?.(key);
  }

  function draft(id: string, value: number) {
    if (last?.id === id && last.value === value) return;
    last = { id, value };
    setLiveKey(id);
    announce(true);
    props.onDraft?.(id, [value]);
  }

  /** A press on a panel. The input handles its own value; all the pane takes
   * from this is the release verdict — a press that never left the dead zone
   * picks the node, a real drag does not (which is why a drag no longer
   * selects). */
  function startPress(e: PointerEvent, node: TraceNode) {
    if (placing() || e.button !== 0) return;
    if (drag.phase() !== "not-started") return; // one pointer, one gesture
    drag.start((init: PointerEvent, target: TraceNode) => {
      // Focus the range so arrow keys land on it after a pointer press: the
      // session suppresses the click that would otherwise move focus, and a
      // slider you cannot nudge from the keyboard after clicking it would give
      // back part of what the native control buys.
      (init.target as Element | null)?.closest?.("input")?.focus();
      return {
        onDone(end) {
          // Covers a gesture whose range `change` never fired (a release the
          // browser swallowed); `commit` is a no-op when `change` got there
          // first, so the value is still written exactly once.
          commit();
          if (end && !end.dragged) props.onPick?.([target]);
          if (end) hoverAt(end.clientX, end.clientY);
        },
      };
    })(e, node);
  }

  // A dock that unmounts mid-edit (pane teardown, scene swap) must not leave the
  // pane reporting a live edit it can never end.
  onCleanup(() => announce(false));

  return (
    <div
      class={styles.dock}
      data-slider-hud
      // Anchored at 0,0; the padding (--space-3 == SLIDER_MARGIN) gives the
      // panels room for their box-shadows inside the scrollable container so
      // outlines are never clipped. Width = panel + both paddings.
      style={{ width: `${SLIDER_PANEL_W + SLIDER_MARGIN * 2}px` }}
      onScroll={(e) => setSliderDockScrollTop(e.currentTarget.scrollTop)}
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
            hot={() => hotKey() === traceKey(node())}
            selected={() => selectedKey()?.startsWith(`${node().id}:`) ?? false}
            placing={() => placing()}
            live={() => liveKey() === traceKey(node())}
            onHoverKey={props.onHoverKey}
            onPointerDown={(e) => startPress(e, node())}
            onInput={(value) => draft(node().id, value)}
            onChange={() => commit()}
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
  live: () => boolean;
  onHoverKey?: (key: string | undefined) => void;
  onPointerDown: (e: PointerEvent) => void;
  onInput: (value: number) => void;
  onChange: () => void;
}) {
  const slider = (): SliderValue => props.node().value as SliderValue;

  const frac = () => {
    const g = slider();
    const span = max(1e-9, g.max - g.min);
    return min(1, max(0, (g.n - g.min) / span));
  };

  return (
    <div
      class={[
        styles.panel,
        props.live() ? styles.dragging : undefined,
        props.hot() && !props.selected() && !props.live() ? styles.hot : undefined,
        props.selected() ? styles.selected : undefined,
      ]}
      data-slider={traceKey(props.node())}
      style={{ height: `${SLIDER_PANEL_H}px` }}
      onPointerDown={(e) => props.onPointerDown(e)}
      onPointerEnter={() => {
        if (!props.placing() && !props.live()) props.onHoverKey?.(traceKey(props.node()));
      }}
      onPointerLeave={() => {
        if (!props.placing() && !props.live()) props.onHoverKey?.(undefined);
      }}
    >
      <div class={styles.head}>
        <span class={styles.label}>{props.node().bind ?? "value"}</span>
        <span class={styles.value}>{formatNum(slider().n)}</span>
      </div>
      {/* The rail and fill are painted under the input: one source of geometry
       * (this box) that the pure hit tests in `sliderHud` also assume, with the
       * native control supplying the thumb and the gesture. */}
      <div class={styles.track} style={{ "--slider-frac": `${frac() * 100}%` }}>
        <span class={styles.rail} />
        <span class={styles.fill} />
        <input
          class={styles.range}
          type="range"
          min={slider().min}
          max={slider().max}
          step={slider().step > 0 ? slider().step : STEP_ANY}
          value={slider().n}
          aria-label={props.node().bind ?? "value"}
          onInput={(e) => props.onInput(parseFloat(e.currentTarget.value))}
          onChange={() => props.onChange()}
        />
      </div>
    </div>
  );
}
