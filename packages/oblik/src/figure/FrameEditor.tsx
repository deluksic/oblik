import { For } from "solid-js";

import { NumberField } from "./NumberField";

import styles from "./FrameEditor.module.css";

export type FrameXywh = { x: number; y: number; width: number; height: number };

export type FrameEditorProps = {
  value: FrameXywh;
  onChange: (next: FrameXywh) => void;
};

const FIELDS: readonly { key: keyof FrameXywh; label: string; min?: number }[] = [
  { key: "x", label: "X" },
  { key: "y", label: "Y" },
  { key: "width", label: "W", min: 0 },
  { key: "height", label: "H", min: 0 },
];

export function FrameEditor(props: FrameEditorProps) {
  return (
    <div class={styles.grid}>
      <For each={FIELDS}>
        {(field) => (
          <NumberField
            label={field.label}
            value={props.value[field.key]}
            min={field.min}
            onChange={(next) => props.onChange({ ...props.value, [field.key]: next })}
          />
        )}
      </For>
    </div>
  );
}
