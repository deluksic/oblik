import { For, Show, createEffect, createSignal } from "solid-js";

import { filterFigureTools, type FigureToolId, type FigureToolSpec } from "./tools";

import styles from "./Palette.module.css";

export type FigurePaletteProps = {
  picker: boolean;
  onPick: (id: FigureToolId) => void;
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

function Picker(props: { onPick: (id: FigureToolId) => void; onClose: () => void }) {
  const [inputEl, setInputEl] = createSignal<HTMLInputElement | null>(null);
  const [query, setQuery] = createSignal("");
  const [active, setActive] = createSignal(0);
  const items = () => filterFigureTools(query());

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
          if (c) props.onPick(c.id);
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
        aria-label="Figure tool"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <input
          ref={setInputEl}
          type="search"
          class={styles.input}
          placeholder="Brush or eraser…"
          autocomplete="off"
          value={query()}
          onInput={(e) => {
            setQuery(e.currentTarget.value);
            setActive(0);
          }}
        />
        <ul class={styles.list}>
          <For each={filterFigureTools(query())} fallback={<p class={styles.empty}>No match.</p>}>
            {(spec, i) => <ToolRow spec={spec} active={active() === i()} onPick={props.onPick} />}
          </For>
        </ul>
      </div>
    </div>
  );
}

function ToolRow(props: { spec: FigureToolSpec; active: boolean; onPick: (id: FigureToolId) => void }) {
  return (
    <li
      class={[styles.listItem, { [styles.listItemActive]: props.active }]}
      onClick={() => props.onPick(props.spec.id)}
    >
      <span class={styles.cmd}>{props.spec.title}</span>
      <span class={styles.cmdHint}>{props.spec.hint}</span>
    </li>
  );
}
