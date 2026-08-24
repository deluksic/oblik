import { For, Show } from "solid-js";

import type { InspectState, LineStyle, OriginView, PointStyle } from "@/types";
import { DEFAULT_LINE_STYLE, DEFAULT_POINT_STYLE } from "@/types";

import styles from "./Inspect.module.css";

export type InspectProps = {
  state: InspectState;
};

export function Inspect(props: InspectProps) {
  return (
    <aside class={styles.inspect}>
      <div class={styles.head}>
        <p class={styles.kicker}>Identity</p>
        <h2 class={styles.crumb}>{props.state.crumb}</h2>
        <p class={styles.meta}>{props.state.meta}</p>
        <Show when={props.state.styleChannel}>
          <StylePanel state={props.state} />
        </Show>
        <p class={styles.kicker}>Origin</p>
      </div>
      <OriginPane origin={props.state.origin} />
    </aside>
  );
}

function OriginPane(props: { origin: OriginView }) {
  const empty = () => props.origin.kind === "empty";
  const who = () => (props.origin.kind === "origin" ? props.origin.who : "");
  const file = () => (props.origin.kind === "origin" ? props.origin.file : "");
  const quote = () => (props.origin.kind === "origin" ? props.origin.quote : []);
  const callers = () => (props.origin.kind === "origin" ? props.origin.callers : []);
  const message = () => (props.origin.kind === "empty" ? props.origin.message : "");
  return (
    <div class={styles.source}>
      <p class={[styles.empty, { [styles.hidden]: !empty() }]}>{message()}</p>
      <div class={[styles.origin, { [styles.hidden]: empty() }]}>
        <p class={styles.originLead}>
          Built by <strong>{who()}</strong> in {file()}
        </p>
        <div class={styles.quote}>
          <For each={quote()}>
            {(row) => (
              <div class={{ [styles.hl]: row.current }}>
                <span class={styles.ln}>{row.line}</span>
                <span class={styles.tx}>{row.text}</span>
              </div>
            )}
          </For>
        </div>
        <Show when={callers().length > 0}>
          <p class={styles.originKicker}>Reached through</p>
          <ol class={styles.originPath}>
            <For each={callers()}>
              {(c) => (
                <li>
                  <span class={styles.originWho}>{c.who}</span>
                  <span class={styles.originLoc}>{c.loc}</span>
                </li>
              )}
            </For>
          </ol>
        </Show>
      </div>
    </div>
  );
}

function hasStoredStyle(style: InspectState["style"]): boolean {
  if (!style) return false;
  const line = style.line;
  const point = style.point;
  return !!(
    (line && (line.color != null || line.width != null || line.dash != null)) ||
    (point && (point.color != null || point.size != null))
  );
}

function StylePanel(props: { state: InspectState }) {
  const channel = () => props.state.styleChannel;
  return (
    <div class={styles.style}>
      <p class={styles.kicker}>Style</p>
      <Show when={channel() === "line"}>
        <LineFields
          stored={props.state.style?.line}
          onChange={(line) => props.state.onStyleChange?.({ ...props.state.style, line })}
        />
      </Show>
      <Show when={channel() === "point"}>
        <PointFields
          stored={props.state.style?.point}
          onChange={(point) => props.state.onStyleChange?.({ ...props.state.style, point })}
        />
      </Show>
      <button
        type="button"
        class={styles.reset}
        disabled={!hasStoredStyle(props.state.style)}
        onClick={() => props.state.onStyleChange?.(null)}
      >
        Use default
      </button>
    </div>
  );
}

function LineFields(props: {
  stored?: LineStyle;
  onChange: (line: LineStyle) => void;
}) {
  const display = () => ({ ...DEFAULT_LINE_STYLE, ...props.stored });
  return (
    <div class={styles.fields}>
      <label class={styles.field}>
        <span>Color</span>
        <input
          type="color"
          value={display().color}
          onInput={(e) => props.onChange({ ...props.stored, color: e.currentTarget.value })}
        />
      </label>
      <label class={styles.field}>
        <span>Width {(display().width ?? 1.5).toFixed(1)}</span>
        <input
          type="range"
          min="0.75"
          max="5"
          step="0.25"
          value={display().width ?? DEFAULT_LINE_STYLE.width}
          onInput={(e) =>
            props.onChange({ ...props.stored, width: Number(e.currentTarget.value) })
          }
        />
      </label>
      <label class={styles.field}>
        <span>Stroke</span>
        <select
          value={display().dash ?? DEFAULT_LINE_STYLE.dash}
          onChange={(e) =>
            props.onChange({
              ...props.stored,
              dash: e.currentTarget.value as NonNullable<LineStyle["dash"]>,
            })
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

function PointFields(props: {
  stored?: PointStyle;
  onChange: (point: PointStyle) => void;
}) {
  const display = () => ({ ...DEFAULT_POINT_STYLE, ...props.stored });
  return (
    <div class={styles.fields}>
      <label class={styles.field}>
        <span>Color</span>
        <input
          type="color"
          value={display().color}
          onInput={(e) => props.onChange({ ...props.stored, color: e.currentTarget.value })}
        />
      </label>
      <label class={styles.field}>
        <span>Size {(display().size ?? 3.5).toFixed(1)}</span>
        <input
          type="range"
          min="2"
          max="12"
          step="0.5"
          value={display().size ?? DEFAULT_POINT_STYLE.size}
          onInput={(e) =>
            props.onChange({ ...props.stored, size: Number(e.currentTarget.value) })
          }
        />
      </label>
    </div>
  );
}
