import { createSignal } from "solid-js";

import { formatNum } from "#source/patch";

import { parseLiveNum, sameNum } from "./number-field";

import styles from "./NumberField.module.css";

export type NumberFieldProps = {
  label: string;
  value: number;
  min?: number;
  onChange: (next: number) => void;
};

export function NumberField(props: NumberFieldProps) {
  const [focused, setFocused] = createSignal(false);
  const [text, setText] = createSignal("");
  const [invalid, setInvalid] = createSignal(false);

  function applyRaw(raw: string) {
    setText(raw);
    const n = parseLiveNum(raw, { min: props.min });
    if (n === undefined) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    if (!sameNum(n, props.value)) props.onChange(n);
  }

  return (
    <label class={styles.field}>
      <span class={styles.label}>{props.label}</span>
      <input
        class={[styles.input, { [styles.invalid]: invalid() }]}
        type="text"
        inputmode="decimal"
        spellcheck={false}
        value={focused() || invalid() ? text() : formatNum(props.value)}
        onFocus={() => {
          setFocused(true);
          setText(invalid() ? text() : formatNum(props.value));
        }}
        onInput={(e) => applyRaw(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          }
          if (e.key === "Escape") {
            setInvalid(false);
            setText(formatNum(props.value));
            setFocused(false);
            e.currentTarget.blur();
          }
        }}
        onBlur={() => {
          setFocused(false);
          if (!invalid()) setText(formatNum(props.value));
        }}
      />
    </label>
  );
}
