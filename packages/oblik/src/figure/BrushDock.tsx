import { For } from "solid-js";

import {
  FILL_COLORS,
  LINE_STYLES,
  STROKE_COLORS,
  STROKE_WIDTHS,
  type BrushSettings,
  type LineStyleId,
} from "./chips";

import styles from "./BrushDock.module.css";

export type BrushDockProps = {
  settings: BrushSettings;
  onChange: (next: BrushSettings) => void;
};

export function BrushDock(props: BrushDockProps) {
  return (
    <div
      class={styles.dock}
      role="toolbar"
      aria-label="Brush"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <Group label="Stroke">
        <For each={[...STROKE_COLORS]}>
          {(color) => (
            <Swatch
              color={color}
              current={props.settings.stroke === color}
              label={`Stroke ${color}`}
              onPick={() => props.onChange({ ...props.settings, stroke: color })}
            />
          )}
        </For>
        <ColorInput
          value={props.settings.stroke}
          fallback="#1c1917"
          current={!STROKE_COLORS.includes(props.settings.stroke as (typeof STROKE_COLORS)[number])}
          label="Custom stroke"
          onPick={(stroke) => props.onChange({ ...props.settings, stroke })}
        />
      </Group>
      <Group label="Fill">
        <For each={[...FILL_COLORS]}>
          {(color) => (
            <Swatch
              color={color}
              current={props.settings.fill === color}
              none={color === "none"}
              label={color === "none" ? "No fill" : `Fill ${color}`}
              onPick={() => props.onChange({ ...props.settings, fill: color })}
            />
          )}
        </For>
        <ColorInput
          value={props.settings.fill}
          fallback="#cfe8d4"
          current={props.settings.fill !== "none" && !FILL_COLORS.includes(props.settings.fill as (typeof FILL_COLORS)[number])}
          label="Custom fill"
          onPick={(fill) => props.onChange({ ...props.settings, fill })}
        />
      </Group>
      <Group label="Width">
        <For each={[...STROKE_WIDTHS]}>
          {(width) => (
            <WidthBtn
              width={width}
              current={props.settings.width === width}
              onPick={() => props.onChange({ ...props.settings, width })}
            />
          )}
        </For>
      </Group>
      <Group label="Style">
        <For each={[...LINE_STYLES]}>
          {(id) => (
            <StyleBtn
              id={id}
              current={props.settings.line === id}
              onPick={() => props.onChange({ ...props.settings, line: id })}
            />
          )}
        </For>
      </Group>
    </div>
  );
}

function Group(props: { label: string; children: import("solid-js").Element }) {
  return (
    <div class={styles.group}>
      <p class={styles.label}>{props.label}</p>
      <div class={styles.row}>{props.children}</div>
    </div>
  );
}

function Swatch(props: {
  color: string;
  current: boolean;
  none?: boolean;
  label: string;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      class={`${styles.swatch}${props.current ? ` ${styles.swatchOn}` : ""}${props.none === true ? ` ${styles.swatchNone}` : ""}`}
      style={props.none ? undefined : { background: props.color }}
      aria-label={props.label}
      aria-pressed={props.current ? "true" : "false"}
      onClick={props.onPick}
    />
  );
}

function ColorInput(props: {
  value: string;
  fallback: string;
  current: boolean;
  label: string;
  onPick: (hex: string) => void;
}) {
  const hex = () => (props.value.startsWith("#") ? props.value : props.fallback);
  return (
    <label class={`${styles.colorWrap}${props.current ? ` ${styles.colorOn}` : ""}`}>
      <span class={styles.srOnly}>{props.label}</span>
      <input
        type="color"
        class={styles.color}
        value={hex()}
        aria-label={props.label}
        onInput={(e) => props.onPick(e.currentTarget.value)}
      />
    </label>
  );
}

function widthName(width: number): string {
  if (width <= 1) return "Thin";
  if (width <= 3) return "Medium";
  return "Thick";
}

function WidthBtn(props: { width: number; current: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      class={`${styles.iconBtn}${props.current ? ` ${styles.iconOn}` : ""}`}
      aria-label={widthName(props.width)}
      aria-pressed={props.current ? "true" : "false"}
      onClick={props.onPick}
    >
      <svg viewBox="0 0 28 16" aria-hidden="true">
        <line
          x1="3"
          y1="8"
          x2="25"
          y2="8"
          stroke="currentColor"
          stroke-width={Math.min(props.width, 6)}
          stroke-linecap="round"
        />
      </svg>
    </button>
  );
}

function StyleBtn(props: { id: LineStyleId; current: boolean; onPick: () => void }) {
  const dash = () => (props.id === "dash" ? "5 3.5" : props.id === "dot" ? "1.2 3.2" : undefined);
  const label = () => (props.id === "solid" ? "Solid" : props.id === "dash" ? "Dash" : "Dot");
  return (
    <button
      type="button"
      class={`${styles.iconBtn}${props.current ? ` ${styles.iconOn}` : ""}`}
      aria-label={label()}
      aria-pressed={props.current ? "true" : "false"}
      onClick={props.onPick}
    >
      <svg viewBox="0 0 28 16" aria-hidden="true">
        <line
          x1="3"
          y1="8"
          x2="25"
          y2="8"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-dasharray={dash()}
        />
      </svg>
    </button>
  );
}
