import { For } from "solid-js";

import styles from "./FrameEditor.module.css";

export type FrameXywh = { x: number; y: number; width: number; height: number };

export type FrameEditorProps = {
  value: FrameXywh;
  /** Fired on commit (blur / Enter), not on every keystroke. */
  onChange: (next: FrameXywh) => void;
};

const FIELDS: readonly { key: keyof FrameXywh; label: string }[] = [
  { key: "x", label: "X" },
  { key: "y", label: "Y" },
  { key: "width", label: "W" },
  { key: "height", label: "H" },
];

export function FrameEditor(props: FrameEditorProps) {
  return (
    <div class={styles.grid}>
      <For each={FIELDS}>
        {(field) => (
          <label class={styles.field}>
            <span class={styles.label}>{field.label}</span>
            <input
              class={styles.input}
              type="number"
              step="0.1"
              value={props.value[field.key]}
              onChange={(e) => {
                const n = Number(e.currentTarget.value);
                if (!Number.isFinite(n)) return;
                props.onChange({ ...props.value, [field.key]: n });
              }}
            />
          </label>
        )}
      </For>
    </div>
  );
}
