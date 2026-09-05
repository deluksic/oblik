import { For, Show, createEffect, createSignal } from "solid-js";

import { filterTools, type Preview, type ToolId, type ToolSpec } from "./tool";

import {
  cmd,
  cmdHint,
  empty,
  input,
  layer,
  listItem,
  listItemActive,
  list,
  picker,
} from "../ui/commandPalette.module.css";
import { panel } from "../ui/surface.module.css";
import styles from "./Palette.module.css";

const { max, min } = Math;
export type PaletteProps = {
  picker: boolean;
  prompt: Preview | undefined;
  onPick: (id: ToolId) => void;
  onClosePicker: () => void;
  onDraft?: (raw: string) => void;
  onTab?: (dir: 1 | -1) => void;
  onCommit?: () => void;
};

export function Palette(props: PaletteProps) {
  return (
    <div class={layer}>
      <Show when={props.picker}>
        <Picker onPick={props.onPick} onClose={props.onClosePicker} />
      </Show>
      <Show when={props.prompt}>
        {(p) => (
          <Prompt
            preview={p()}
            onDraft={props.onDraft}
            onTab={props.onTab}
            onCommit={props.onCommit}
          />
        )}
      </Show>
    </div>
  );
}

function Prompt(props: {
  preview: Preview;
  onDraft?: (raw: string) => void;
  onTab?: (dir: 1 | -1) => void;
  onCommit?: () => void;
}) {
  const [inputEl, setInputEl] = createSignal<HTMLInputElement | undefined>(undefined);

  createEffect(
    () => [inputEl(), props.preview.draft?.id ?? ""] as const,
    ([el, id]) => {
      if (!el || !id) return;
      queueMicrotask(() => {
        el.focus();
        const end = el.value.length;
        el.setSelectionRange(end, end);
      });
    },
  );

  const slotWidth = () => {
    const d = props.preview.draft;
    const token = props.preview.token ?? d?.placeholder ?? "";
    const text = d?.value || token;
    return `${max(text.length, 1) + 1}ch`;
  };

  return (
    <div class={styles.promptDock}>
      <div
        class={[styles.prompt, { [styles.promptInvalid]: props.preview.draft?.invalid === true }]}
      >
        <Show
          when={props.preview.draft && props.preview.before !== undefined}
          fallback={<p class={styles.preview}>{props.preview.line}</p>}
        >
          <p class={[styles.preview, styles.hasSlot]}>
            <span class={styles.dim}>{props.preview.before}</span>
            <input
              ref={setInputEl}
              type="text"
              class={[styles.slot, { [styles.slotInvalid]: props.preview.draft?.invalid === true }]}
              style={{ width: slotWidth() }}
              inputmode={props.preview.draft?.kind === "number" ? "decimal" : "text"}
              autocomplete="off"
              spellcheck={false}
              value={props.preview.draft?.value ?? ""}
              placeholder={props.preview.token ?? props.preview.draft?.placeholder ?? ""}
              aria-label={props.preview.draft?.placeholder}
              onInput={(e) => props.onDraft?.(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Tab") {
                  e.preventDefault();
                  props.onTab?.(e.shiftKey ? -1 : 1);
                  return;
                }
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (props.preview.draft?.invalid) return;
                  props.onCommit?.();
                }
              }}
            />
            <span class={styles.dim}>{props.preview.after}</span>
          </p>
        </Show>
        <p class={[styles.hint, { [styles.hintError]: props.preview.draft?.invalid === true }]}>
          {props.preview.draft?.error ?? props.preview.hint}
        </p>
      </div>
    </div>
  );
}

function Picker(props: { onPick: (id: ToolId) => void; onClose: () => void }) {
  const [inputEl, setInputEl] = createSignal<HTMLInputElement | undefined>(undefined);
  const [query, setQuery] = createSignal("");
  const [active, setActive] = createSignal(0);
  const items = () => filterTools(query());

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
          setActive((i) => min(items().length - 1, i + 1));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setActive((i) => max(0, i - 1));
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
    <div class={[picker, styles.scrim]} onPointerDown={() => props.onClose()}>
      <div
        class={[panel, styles.panel]}
        role="dialog"
        aria-label="Insert"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <input
          ref={setInputEl}
          type="search"
          class={input}
          placeholder="Search..."
          autocomplete="off"
          value={query()}
          onInput={(e) => {
            setQuery(e.currentTarget.value);
            setActive(0);
          }}
        />
        <ul class={list}>
          <For each={filterTools(query())} fallback={<p class={empty}>No match.</p>}>
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
      class={[listItem, { [listItemActive]: props.active }]}
      onClick={() => props.onPick(props.spec.id)}
    >
      <span class={cmd}>{props.spec.title}</span>
      <span class={cmdHint}>{props.spec.hint}</span>
    </li>
  );
}
