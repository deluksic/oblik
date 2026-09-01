import { For, createSignal } from "solid-js";

import { formatNum } from "@/source/patch";

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

function FrameField(props: {
  label: string;
  value: number;
  onCommit: (next: number) => void;
}) {
  const [draft, setDraft] = createSignal("");
  const [editing, setEditing] = createSignal(false);

  function commit() {
    const n = Number(draft());
    if (Number.isFinite(n)) props.onCommit(n);
    setEditing(false);
  }

  return (
    <label class={styles.field}>
      <span class={styles.label}>{props.label}</span>
      <input
        class={styles.input}
        type="text"
        inputmode="decimal"
        value={editing() ? draft() : formatNum(props.value)}
        onFocus={() => {
          setEditing(true);
          setDraft(formatNum(props.value));
        }}
        onInput={(e) => setDraft(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          }
          if (e.key === "Escape") {
            setDraft(formatNum(props.value));
            setEditing(false);
            e.currentTarget.blur();
          }
        }}
        onBlur={commit}
      />
    </label>
  );
}

export function FrameEditor(props: FrameEditorProps) {
  return (
    <div class={styles.grid}>
      <For each={FIELDS}>
        {(field) => (
          <FrameField
            label={field.label}
            value={props.value[field.key]}
            onCommit={(next) => props.onChange({ ...props.value, [field.key]: next })}
          />
        )}
      </For>
    </div>
  );
}
