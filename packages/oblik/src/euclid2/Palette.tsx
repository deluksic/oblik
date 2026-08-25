import { For, Show, createEffect, createSignal } from "solid-js";

import { filterTools, type Preview, type ToolId, type ToolSpec } from "./tool";
import styles from "./Palette.module.css";

export type PaletteProps = {
  picker: boolean;
  prompt: Preview | null;
  onPick: (id: ToolId) => void;
  onClosePicker: () => void;
  onDraft?: (raw: string) => void;
  onTab?: (dir: 1 | -1) => void;
  onCommit?: () => void;
};

export function Palette(props: PaletteProps) {
  return (
    <div class={styles.layer}>
      <Show when={props.picker}>
        <Picker onPick={props.onPick} onClose={props.onClosePicker} />
      </Show>
      <Show when={props.prompt}>
        {(p) => (
          <div class={styles.promptDock}>
            <div class={[styles.prompt, { [styles.promptInvalid]: p().draft?.invalid === true }]}>
              <p class={styles.preview}>{p().line}</p>
              <Show when={p().draft}>
                {(d) => (
                  <input
                    type="text"
                    class={[styles.draft, { [styles.draftInvalid]: d().invalid }]}
                    inputmode={d().kind === "ident" ? "text" : "decimal"}
                    autocomplete="off"
                    spellcheck={false}
                    value={d().value}
                    placeholder={d().placeholder}
                    aria-label={d().placeholder}
                    onInput={(e) => props.onDraft?.(e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Tab") {
                        e.preventDefault();
                        props.onTab?.(e.shiftKey ? -1 : 1);
                        return;
                      }
                      if (e.key === "Enter") {
                        e.preventDefault();
                        if (d().invalid) return;
                        props.onCommit?.();
                      }
                    }}
                  />
                )}
              </Show>
              <p class={[styles.hint, { [styles.hintError]: p().draft?.invalid === true }]}>
                {p().draft?.error ?? p().hint}
              </p>
            </div>
          </div>
        )}
      </Show>
    </div>
  );
}

function Picker(props: { onPick: (id: ToolId) => void; onClose: () => void }) {
  const [inputEl, setInputEl] = createSignal<HTMLInputElement | null>(null);
  const [query, setQuery] = createSignal("");
  const [active, setActive] = createSignal(0);
  const items = () => {
    const list = filterTools(query());
    return list;
  };

  createEffect(
    () => inputEl(),
    (el) => {
      if (!el) return;
      el.focus();
      const onKey = (e: KeyboardEvent) => {
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
        aria-label="Insert"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <input
          ref={setInputEl}
          type="search"
          class={styles.input}
          placeholder="Point, circle, line, segment, parallel"
          autocomplete="off"
          value={query()}
          onInput={(e) => {
            setQuery(e.currentTarget.value);
            setActive(0);
          }}
        />
        <ul class={styles.list}>
          <For each={filterTools(query())} fallback={<p class={styles.empty}>No match.</p>}>
            {(spec, i) => <ToolRow spec={spec} active={active() === i()} onPick={props.onPick} />}
          </For>
        </ul>
      </div>
    </div>
  );
}

function ToolRow(props: { spec: ToolSpec; active: boolean; onPick: (id: ToolId) => void }) {
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
