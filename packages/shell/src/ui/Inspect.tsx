import { For, Show } from "solid-js";

import type { InspectState, LineDash, LineStyle, OriginView, PointStyle } from "@/types";

import styles from "./Inspect.module.css";
import {
  COLOR_PRESETS,
  DASH_PRESETS,
  LINE_WIDTH_PRESETS,
  POINT_SIZE_PRESETS,
  colorValueForPreset,
  dashValueForPreset,
  pickerHex,
  selectedColorId,
  selectedDash,
  selectedLineWidthId,
  selectedPointSizeId,
  sizeValueForPreset,
  widthValueForPreset,
  type SizePresetId,
} from "./style-presets";

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
  return (
    <div class={styles.fields}>
      <ColorRow
        color={props.stored?.color}
        onChange={(color) => props.onChange({ ...props.stored, color })}
      />
      <div class={styles.row}>
        <p class={styles.rowLabel}>Width</p>
        <div class={styles.chips} role="group" aria-label="Width">
          <For each={LINE_WIDTH_PRESETS}>
            {(preset) => (
              <PreviewChip
                label={preset.label}
                selected={selectedLineWidthId(props.stored?.width) === preset.id}
                onPick={() => props.onChange({ ...props.stored, width: widthValueForPreset(preset.id) })}
              >
                <LinePreview stroke={strokeForWidth(preset.id)} />
              </PreviewChip>
            )}
          </For>
        </div>
      </div>
      <div class={styles.row}>
        <p class={styles.rowLabel}>Stroke</p>
        <div class={styles.chips} role="group" aria-label="Stroke">
          <For each={DASH_PRESETS}>
            {(preset) => (
              <PreviewChip
                label={preset.label}
                selected={selectedDash(props.stored?.dash) === preset.id}
                onPick={() => props.onChange({ ...props.stored, dash: dashValueForPreset(preset.id) })}
              >
                <LinePreview stroke={2} dash={preset.id} />
              </PreviewChip>
            )}
          </For>
        </div>
      </div>
    </div>
  );
}

function PointFields(props: {
  stored?: PointStyle;
  onChange: (point: PointStyle) => void;
}) {
  return (
    <div class={styles.fields}>
      <ColorRow
        color={props.stored?.color}
        onChange={(color) => props.onChange({ ...props.stored, color })}
      />
      <div class={styles.row}>
        <p class={styles.rowLabel}>Size</p>
        <div class={styles.chips} role="group" aria-label="Size">
          <For each={POINT_SIZE_PRESETS}>
            {(preset) => (
              <PreviewChip
                label={preset.label}
                selected={selectedPointSizeId(props.stored?.size) === preset.id}
                onPick={() => props.onChange({ ...props.stored, size: sizeValueForPreset(preset.id) })}
              >
                <svg class={styles.preview} viewBox="0 0 44 20" aria-hidden="true">
                  <circle cx="22" cy="10" r={radiusForSize(preset.id)} fill="currentColor" />
                </svg>
              </PreviewChip>
            )}
          </For>
        </div>
      </div>
    </div>
  );
}

function ColorRow(props: {
  color: string | undefined;
  onChange: (color: string | undefined) => void;
}) {
  return (
    <div class={styles.row}>
      <p class={styles.rowLabel}>Color</p>
      <div class={styles.chips} role="group" aria-label="Color">
        <For each={COLOR_PRESETS}>
          {(preset) => <ColorChip preset={preset} color={props.color} onPick={props.onChange} />}
        </For>
      </div>
    </div>
  );
}

function ColorChip(props: {
  preset: (typeof COLOR_PRESETS)[number];
  color: string | undefined;
  onPick: (color: string | undefined) => void;
}) {
  const selected = () => selectedColorId(props.color) === props.preset.id;
  const custom = () => selectedColorId(props.color) === "custom";
  return (
    <Show
      when={props.preset.id === "custom"}
      fallback={
        <button
          type="button"
          title={props.preset.label}
          aria-label={props.preset.label}
          aria-pressed={selected() ? "true" : "false"}
          class={[styles.chip, styles.swatch, { [styles.chipSelected]: selected() }]}
          onClick={() => props.onPick(colorValueForPreset(props.preset.id))}
        >
          <span
            class={[styles.swatchFill, { [styles.swatchDefault]: props.preset.id === "default" }]}
            style={props.preset.hex ? { background: props.preset.hex } : undefined}
          />
        </button>
      }
    >
      <label
        title={props.preset.label}
        class={[styles.chip, styles.swatch, { [styles.chipSelected]: selected() }]}
      >
        <span
          class={[styles.swatchFill, { [styles.swatchRainbow]: !custom() }]}
          style={custom() ? { background: pickerHex(props.color) } : undefined}
        />
        <input
          type="color"
          class={styles.colorInput}
          aria-label="Custom color"
          value={pickerHex(props.color)}
          onInput={(e) => props.onPick(e.currentTarget.value)}
        />
      </label>
    </Show>
  );
}

function PreviewChip(props: {
  label: string;
  selected: boolean;
  onPick: () => void;
  children: import("solid-js").Element;
}) {
  return (
    <button
      type="button"
      title={props.label}
      aria-label={props.label}
      aria-pressed={props.selected ? "true" : "false"}
      class={[styles.chip, styles.chipGrow, { [styles.chipSelected]: props.selected }]}
      onClick={() => props.onPick()}
    >
      {props.children}
    </button>
  );
}

function LinePreview(props: { stroke: number; dash?: LineDash }) {
  const dasharray = () =>
    props.dash === "dashed" ? "7 5" : props.dash === "dotted" ? "0.1 4.5" : undefined;
  return (
    <svg class={styles.preview} viewBox="0 0 44 20" aria-hidden="true">
      <line
        x1="6"
        y1="10"
        x2="38"
        y2="10"
        stroke="currentColor"
        stroke-width={props.stroke}
        stroke-linecap="round"
        stroke-dasharray={dasharray()}
      />
    </svg>
  );
}

function strokeForWidth(id: SizePresetId): number {
  if (id === "small") return 1.2;
  if (id === "wide") return 4;
  return 2.25;
}

function radiusForSize(id: SizePresetId): number {
  if (id === "small") return 2.2;
  if (id === "wide") return 5.4;
  return 3.4;
}
