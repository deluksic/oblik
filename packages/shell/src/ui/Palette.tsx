import { For, Show, createEffect, createMemo, createSignal } from "solid-js";

import { filterCommands } from "@/palette/filter";
import type { CommandBarState, CommandSpec } from "@/types";

import styles from "./Palette.module.css";


const { max, min } = Math;
export type PaletteMode = "closed" | "picker" | "prompt";

function parseDraft(raw: string): number | null {
  const n = Number(raw.trim());
  return raw.trim() !== "" && Number.isFinite(n) ? n : null;
}

export type PaletteProps = {
  mode: PaletteMode;
  commandBar: CommandBarState | null;
  commands: () => CommandSpec[];
  onPick: (id: string) => void;
  onClosePicker: () => void;
  onNumberDraft: (raw: string) => void;
};

type InlineNumberLayout = {
  previewHtml: string;
  mode: PaletteMode;
  numberValue: string;
  acceptNumber: boolean;
};

function PickerPanel(props: {
  commands: () => CommandSpec[];
  onPick: (id: string) => void;
  onClosePicker: () => void;
}) {
  const inputRef = { current: null as HTMLInputElement | null };
  const [query, setQuery] = createSignal("");
  const [active, setActive] = createSignal(0);
  const items = createMemo(() => filterCommands(props.commands(), query()));

  function focusQueryInput(): void {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
  }

  function onPickerKey(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      props.onClosePicker();
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
      return;
    }
    if (e.code === "Space" || e.key === " ") {
      if (query().trim() === "") {
        e.preventDefault();
        props.onClosePicker();
        return;
      }
      if (document.activeElement !== inputRef.current) {
        e.preventDefault();
        setQuery((q) => `${q} `);
        setActive(0);
        focusQueryInput();
      }
      return;
    }
    if (document.activeElement === inputRef.current) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "Backspace") {
      e.preventDefault();
      setQuery((q) => q.slice(0, -1));
      setActive(0);
      focusQueryInput();
      return;
    }
    if (e.key.length === 1 && e.key !== " ") {
      e.preventDefault();
      setQuery((q) => q + e.key);
      setActive(0);
      focusQueryInput();
    }
  }

  createEffect(
    () => true,
    () => {
      queueMicrotask(focusQueryInput);
      window.addEventListener("keydown", onPickerKey);
      return () => window.removeEventListener("keydown", onPickerKey);
    },
  );

  return (
    <div class={styles.panel} role="dialog" aria-label="Add editor">
      <input
        ref={(el) => {
          inputRef.current = el;
        }}
        type="search"
        class={styles.input}
        placeholder="Point, distance…"
        autocomplete="off"
        spellcheck={false}
        value={query()}
        onInput={(e) => {
          setQuery(e.currentTarget.value);
          setActive(0);
        }}
      />
      <ul class={styles.list} role="listbox">
        <For each={items()} keyed={false}>
          {(cmd, i) => (
            <li
              class={[styles.listItem, { [styles.listItemActive]: i === active() }]}
              role="option"
              onPointerDown={(e) => {
                e.preventDefault();
                props.onPick(cmd().id);
              }}
            >
              <span class={styles.cmd}>{cmd().title}</span>
              <span class={styles.cmdHint}>{cmd().hint}</span>
            </li>
          )}
        </For>
      </ul>
      <Show when={items().length === 0}>
        <p class={styles.empty}>No editors to add in this view.</p>
      </Show>
    </div>
  );
}

export function Palette(props: PaletteProps) {
  const previewRef = { current: null as HTMLElement | null };
  const numberRef = { current: null as HTMLInputElement | null };

  function layoutInlineNumber(layout: InlineNumberLayout): void {
    if (!layout.acceptNumber || !previewRef.current || !numberRef.current) return;
    const slot = previewRef.current.querySelector<HTMLElement>(".slot.is-number");
    if (!slot) return;
    const row = previewRef.current.parentElement;
    if (!row) return;
    const slotRect = slot.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    numberRef.current.style.left = `${slotRect.left - rowRect.left}px`;
    numberRef.current.style.top = `${slotRect.top - rowRect.top}px`;
    numberRef.current.style.width = `${max(slotRect.width, 1)}px`;
    numberRef.current.style.height = `${slotRect.height}px`;
  }

  function tryCommit(commandBar: CommandBarState | null): void {
    if (commandBar?.draftInvalid) return;
    if (commandBar?.onCommit) {
      commandBar.onCommit();
      return;
    }
    if (!commandBar?.onNumber || !numberRef.current) return;
    const n = parseDraft(numberRef.current.value);
    if (n == null) return;
    commandBar.onNumber(n);
  }

  createEffect(
    () => props.mode === "prompt" && props.commandBar?.acceptNumber === true,
    (focusNumber) => {
      if (!focusNumber) return;
      queueMicrotask(() => {
        const el = numberRef.current;
        if (!el) return;
        el.focus();
        const end = el.value.length;
        el.setSelectionRange(end, end);
      });
    },
  );

  createEffect(
    () =>
      [
        props.commandBar?.previewHtml ?? "",
        props.mode,
        props.commandBar?.numberValue ?? "",
        props.commandBar?.acceptNumber === true,
        props.commandBar?.draftKind ?? "number",
        props.commandBar?.draftInvalid === true,
      ] as const,
    (layout) => {
      layoutInlineNumber({
        previewHtml: layout[0],
        mode: layout[1],
        numberValue: layout[2],
        acceptNumber: layout[3],
      });
    },
  );

  return (
    <Show when={props.mode !== "closed"}>
      <div
        class={[
          styles.wrap,
          {
            [styles.picker]: props.mode === "picker",
            [styles.promptDock]: props.mode === "prompt",
            [styles.hasInlineNumber]: props.commandBar?.acceptNumber === true,
            [styles.isTyping]: (props.commandBar?.numberValue?.trim() ?? "") !== "",
            [styles.promptInvalid]: props.commandBar?.draftInvalid === true,
          },
        ]}
        onPointerDown={(e) => {
          if (props.mode === "picker" && e.target === e.currentTarget) props.onClosePicker();
        }}
      >
        <Show when={props.mode === "picker"}>
          <PickerPanel
            commands={props.commands}
            onPick={props.onPick}
            onClosePicker={props.onClosePicker}
          />
        </Show>
        <Show when={props.mode === "prompt"}>
          <div class={styles.prompt} role="status" aria-live="polite">
            <div class={styles.previewRow}>
              <code
                class={styles.preview}
                ref={(el) => {
                  previewRef.current = el;
                }}
                innerHTML={props.commandBar?.previewHtml ?? ""}
              />
              <Show when={props.commandBar?.acceptNumber}>
                <input
                  ref={(el) => {
                    numberRef.current = el;
                  }}
                  type="text"
                  class={[styles.number, { [styles.numberInvalid]: props.commandBar?.draftInvalid === true }]}
                  inputmode={props.commandBar?.draftKind === "ident" ? "text" : "decimal"}
                  autocomplete="off"
                  spellcheck={false}
                  value={props.commandBar?.numberValue ?? ""}
                  onInput={(e) => {
                    props.onNumberDraft(e.currentTarget.value);
                    requestAnimationFrame(() =>
                      layoutInlineNumber({
                        previewHtml: props.commandBar?.previewHtml ?? "",
                        mode: props.mode,
                        numberValue: e.currentTarget.value,
                        acceptNumber: props.commandBar?.acceptNumber === true,
                      }),
                    );
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Tab" && props.commandBar?.onNextField) {
                      e.preventDefault();
                      props.commandBar.onNextField(e.shiftKey ? -1 : 1);
                      return;
                    }
                    if (e.key === "Enter") {
                      e.preventDefault();
                      tryCommit(props.commandBar);
                    }
                  }}
                />
              </Show>
            </div>
            <p class={[styles.hint, { [styles.hintError]: props.commandBar?.draftInvalid === true }]}>
              {props.commandBar?.hint ?? ""}
            </p>
          </div>
        </Show>
      </div>
    </Show>
  );
}
