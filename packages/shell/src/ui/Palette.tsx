import { For, Show, createEffect, createMemo, createSignal } from "solid-js";

import { filterCommands } from "../palette.ts";
import type { CommandBarState, CommandSpec } from "../types.ts";

import styles from "./Palette.module.css";

export type PaletteMode = "closed" | "picker" | "prompt";

function parseDraft(raw: string): number | null {
  const n = Number(raw.trim());
  return raw.trim() !== "" && Number.isFinite(n) ? n : null;
}

export type PaletteProps = {
  mode: () => PaletteMode;
  commandBar: () => CommandBarState | null;
  getCommands: () => CommandSpec[];
  onPick: (id: string) => void;
  onClosePicker: () => void;
  onNumberDraft: (raw: string) => void;
};

export function Palette(props: PaletteProps) {
  const [query, setQuery] = createSignal("");
  const [active, setActive] = createSignal(0);
  const previewRef = { current: null as HTMLElement | null };
  const numberRef = { current: null as HTMLInputElement | null };

  const items = createMemo(() => filterCommands(props.getCommands(), query()));

  createEffect(
    () => props.mode(),
    () => {
      if (props.mode() === "picker") {
        setQuery("");
        setActive(0);
      }
    },
  );

  createEffect(
    () => [props.commandBar()?.previewHtml, props.mode(), props.commandBar()?.numberValue] as const,
    () => {
      layoutInlineNumber();
    },
  );

  function layoutInlineNumber(): void {
    const bar = props.commandBar();
    if (!bar?.acceptNumber || !previewRef.current || !numberRef.current) return;
    const slot = previewRef.current.querySelector<HTMLElement>(".slot.is-number");
    if (!slot) return;
    const typed = numberRef.current.value;
    slot.textContent = typed || "<radius>";
    slot.dataset.placeholder = typed ? typed : "<radius>";
    const row = previewRef.current.parentElement;
    if (!row) return;
    const slotRect = slot.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    numberRef.current.style.left = `${slotRect.left - rowRect.left}px`;
    numberRef.current.style.top = `${slotRect.top - rowRect.top}px`;
    numberRef.current.style.width = `${Math.max(slotRect.width, 1)}px`;
    numberRef.current.style.height = `${slotRect.height}px`;
  }

  function tryCommitNumber(): void {
    const bar = props.commandBar();
    if (!bar?.onNumber || !numberRef.current) return;
    const n = parseDraft(numberRef.current.value);
    if (n == null) return;
    bar.onNumber(n);
  }

  function onPickerKey(e: KeyboardEvent): void {
    if (props.mode() !== "picker") return;
    if (e.key === "Escape") {
      e.preventDefault();
      props.onClosePicker();
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
  }

  createEffect(
    () => props.mode(),
    (mode) => {
      if (mode === "picker") {
        window.addEventListener("keydown", onPickerKey);
        return () => window.removeEventListener("keydown", onPickerKey);
      }
    },
  );

  return (
    <Show when={props.mode() !== "closed"}>
      <div
        class={[
          styles.wrap,
          {
            [styles.picker]: props.mode() === "picker",
            [styles.promptDock]: props.mode() === "prompt",
            [styles.hasInlineNumber]: props.commandBar()?.acceptNumber === true,
            [styles.isTyping]: (props.commandBar()?.numberValue?.trim() ?? "") !== "",
          },
        ]}
        onPointerDown={(e) => {
          if (props.mode() === "picker" && e.target === e.currentTarget) props.onClosePicker();
        }}
      >
        <Show when={props.mode() === "picker"}>
          <div class={styles.panel} role="dialog" aria-label="Add editor">
            <input
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
                    class={[styles.listItem, { [styles.listItemActive]: i() === active() }]}
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
        </Show>
        <Show when={props.mode() === "prompt"}>
          <div class={styles.prompt} role="status" aria-live="polite">
            <div class={styles.previewRow}>
              <code
                class={styles.preview}
                ref={(el) => {
                  previewRef.current = el;
                }}
                innerHTML={props.commandBar()?.previewHtml ?? ""}
              />
              <Show when={props.commandBar()?.acceptNumber}>
                <input
                  ref={(el) => {
                    numberRef.current = el;
                  }}
                  type="text"
                  class={styles.number}
                  inputmode="decimal"
                  autocomplete="off"
                  spellcheck={false}
                  value={props.commandBar()?.numberValue ?? ""}
                  onInput={(e) => {
                    props.onNumberDraft(e.currentTarget.value);
                    requestAnimationFrame(layoutInlineNumber);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      tryCommitNumber();
                    }
                  }}
                />
              </Show>
            </div>
            <p class={styles.hint}>{props.commandBar()?.hint ?? ""}</p>
          </div>
        </Show>
      </div>
    </Show>
  );
}
