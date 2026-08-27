import { For, Show, createEffect, createSignal } from "solid-js";

import { filterChips, type StyleChip } from "./chips";

import styles from "./Palette.module.css";

export type FigurePaletteProps = {
  picker: boolean;
  onPick: (chip: StyleChip) => void;
  onClosePicker: () => void;
};

export function FigurePalette(props: FigurePaletteProps) {
  return (
    <div class={styles.layer}>
      <Show when={props.picker}>
        <Picker onPick={props.onPick} onClose={props.onClosePicker} />
      </Show>
    </div>
  );
}

function Picker(props: { onPick: (chip: StyleChip) => void; onClose: () => void }) {
  const [inputEl, setInputEl] = createSignal<HTMLInputElement | null>(null);
  const [query, setQuery] = createSignal("");
  const [active, setActive] = createSignal(0);
  const items = () => filterChips(query());

  createEffect(
    () => inputEl(),
    (el) => {
      if (!el) return;
      el.focus();
      const onKey = (e: KeyboardEvent) => {
        if (e.code === "Space" && query().trim() === "") {
          e.preventDefault();
          props.onClose();
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          props.onClose();
          return;
        }
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setActive((i) => Math.min(items().length - 1, i + 1));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setActive((i) => Math.max(0, i - 1));
          return;
        }
        if (e.key === "Enter") {
          e.preventDefault();
          const c = items()[active()];
          if (c) props.onPick(c);
        }
      };
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    },
  );

  return (
    <div class={styles.picker} onPointerDown={props.onClose}>
      <div
        class={styles.panel}
        role="dialog"
        aria-label="Paint style"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <input
          ref={setInputEl}
          type="search"
          class={styles.input}
          placeholder="Paint with…"
          autocomplete="off"
          value={query()}
          onInput={(e) => {
            setQuery(e.currentTarget.value);
            setActive(0);
          }}
        />
        <ul class={styles.list}>
          <For each={filterChips(query())} fallback={<p class={styles.empty}>No match.</p>}>
            {(chip, i) => <ChipRow chip={chip} active={active() === i()} onPick={props.onPick} />}
          </For>
        </ul>
      </div>
    </div>
  );
}

function ChipRow(props: { chip: StyleChip; active: boolean; onPick: (chip: StyleChip) => void }) {
  return (
    <li
      class={[styles.listItem, { [styles.listItemActive]: props.active }]}
      onClick={() => props.onPick(props.chip)}
    >
      <span class={styles.cmd}>{props.chip.title}</span>
      <span class={styles.cmdHint}>{hintOf(props.chip)}</span>
    </li>
  );
}

function hintOf(chip: StyleChip): string {
  const s = chip.style;
  const bits: string[] = [];
  if (s.width != null) bits.push(`${s.width}px`);
  if (s.dash) bits.push("dashed");
  if (s.fill && s.fill !== "none") bits.push("fill");
  if (s.point) bits.push(s.point);
  return bits.join(" · ") || "stroke";
}
