import { Show } from "solid-js";

import type { InspectState, LineStyle, PointStyle } from "@/types";
import { DEFAULT_LINE_STYLE, DEFAULT_POINT_STYLE } from "@/types";

import styles from "./Inspect.module.css";

export type InspectProps = {
  state: InspectState;
};

export function Inspect(props: InspectProps) {
  return (
    <aside class={styles.inspect}>
      <p class={styles.kicker}>Identity</p>
      <h2 class={styles.crumb}>{props.state.crumb}</h2>
      <p class={styles.meta}>{props.state.meta}</p>
      <Show when={props.state.styleChannel}>
        <StylePanel state={props.state} />
      </Show>
      <p class={styles.kicker}>Origin</p>
      <div class={styles.source} innerHTML={props.state.sourceHtml} />
    </aside>
  );
}

function StylePanel(props: { state: InspectState }) {
  const channel = () => props.state.styleChannel;
  const styled = () => props.state.style != null;
  return (
    <div class={styles.style}>
      <p class={styles.kicker}>Style</p>
      <p class={styles.styleHint}>
        {styled() ? "Stored on this constructor in the scene file." : "Using the view default. Change a value to write { style } on the constructor."}
      </p>
      <Show when={channel() === "line"}>
        <LineFields
          line={props.state.style?.line ?? DEFAULT_LINE_STYLE}
          onChange={(line) => props.state.onStyleChange?.({ ...props.state.style, line })}
        />
      </Show>
      <Show when={channel() === "point"}>
        <PointFields
          point={props.state.style?.point ?? DEFAULT_POINT_STYLE}
          onChange={(point) => props.state.onStyleChange?.({ ...props.state.style, point })}
        />
      </Show>
      <button
        type="button"
        class={styles.reset}
        disabled={!styled()}
        onClick={() => props.state.onStyleChange?.(null)}
      >
        Use default
      </button>
    </div>
  );
}

function LineFields(props: { line: LineStyle; onChange: (line: LineStyle) => void }) {
  return (
    <div class={styles.fields}>
      <label class={styles.field}>
        <span>Color</span>
        <input
          type="color"
          value={props.line.color}
          onInput={(e) => props.onChange({ ...props.line, color: e.currentTarget.value })}
        />
      </label>
      <label class={styles.field}>
        <span>Width {props.line.width.toFixed(1)}</span>
        <input
          type="range"
          min="0.75"
          max="5"
          step="0.25"
          value={props.line.width}
          onInput={(e) => props.onChange({ ...props.line, width: Number(e.currentTarget.value) })}
        />
      </label>
      <label class={styles.field}>
        <span>Stroke</span>
        <select
          value={props.line.dash}
          onChange={(e) =>
            props.onChange({ ...props.line, dash: e.currentTarget.value as LineStyle["dash"] })
          }
        >
          <option value="solid">Solid</option>
          <option value="dashed">Dashed</option>
          <option value="dotted">Dotted</option>
        </select>
      </label>
    </div>
  );
}

function PointFields(props: { point: PointStyle; onChange: (point: PointStyle) => void }) {
  return (
    <div class={styles.fields}>
      <label class={styles.field}>
        <span>Color</span>
        <input
          type="color"
          value={props.point.color}
          onInput={(e) => props.onChange({ ...props.point, color: e.currentTarget.value })}
        />
      </label>
      <label class={styles.field}>
        <span>Size {props.point.size.toFixed(1)}</span>
        <input
          type="range"
          min="2"
          max="12"
          step="0.5"
          value={props.point.size}
          onInput={(e) => props.onChange({ ...props.point, size: Number(e.currentTarget.value) })}
        />
      </label>
    </div>
  );
}
