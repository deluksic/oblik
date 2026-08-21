import type { CommandSpec } from "./types.ts";

export type { CommandSpec };

export type PromptOpts = {
  previewHtml: string;
  acceptNumber?: boolean;
  hint?: string;
  numberValue?: string;
  onNumber?: (n: number) => void;
  onNumberDraft?: (raw: string) => void;
};

export function filterCommands(commands: readonly CommandSpec[], query: string): CommandSpec[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...commands];
  return commands.filter(
    (c) =>
      c.title.toLowerCase().includes(q) ||
      c.id.toLowerCase().includes(q) ||
      c.hint.toLowerCase().includes(q),
  );
}

export type PaletteOpts = {
  root: HTMLElement;
  getCommands: () => CommandSpec[];
  onPick: (id: string) => void;
  onClose: () => void;
};

function parseDraft(raw: string): number | null {
  const n = Number(raw.trim());
  return raw.trim() !== "" && Number.isFinite(n) ? n : null;
}

export function mountCommandPalette(opts: PaletteOpts): {
  open: () => void;
  dockPrompt: (prompt: PromptOpts) => void;
  closePrompt: () => void;
  close: () => void;
  isOpen: () => boolean;
  isPromptOpen: () => boolean;
  setAnchor: (root: HTMLElement) => void;
  dispose: () => void;
} {
  const wrap = document.createElement("div");
  wrap.className = "shell-palette";
  wrap.hidden = true;
  wrap.innerHTML = `
    <div class="shell-palette-panel shell-palette-picker" role="dialog" aria-label="Add editor" hidden>
      <input type="search" class="shell-palette-input" placeholder="Point, distance…" autocomplete="off" spellcheck="false" />
      <ul class="shell-palette-list" role="listbox"></ul>
      <p class="shell-palette-empty" hidden>No editors to add in this view.</p>
    </div>
    <div class="shell-palette-prompt" role="status" aria-live="polite" hidden>
      <div class="shell-palette-preview-row">
        <code class="shell-palette-preview"></code>
        <input type="text" class="shell-palette-number" inputmode="decimal" autocomplete="off" spellcheck="false" hidden />
      </div>
      <p class="shell-palette-hint"></p>
    </div>
  `;
  opts.root.append(wrap);

  const pickerPanel = wrap.querySelector<HTMLElement>(".shell-palette-picker")!;
  const promptPanel = wrap.querySelector<HTMLElement>(".shell-palette-prompt")!;
  const input = wrap.querySelector<HTMLInputElement>(".shell-palette-input")!;
  const list = wrap.querySelector<HTMLUListElement>(".shell-palette-list")!;
  const empty = wrap.querySelector<HTMLElement>(".shell-palette-empty")!;
  const preview = wrap.querySelector<HTMLElement>(".shell-palette-preview")!;
  const numberInput = wrap.querySelector<HTMLInputElement>(".shell-palette-number")!;
  const hintEl = wrap.querySelector<HTMLElement>(".shell-palette-hint")!;

  let items: CommandSpec[] = [];
  let active = 0;
  let pickerOpen = false;
  let promptOpen = false;
  let onNumber: ((n: number) => void) | undefined;
  let onNumberDraft: ((raw: string) => void) | undefined;
  let lastPreviewHtml = "";
  let lastAcceptNumber = false;

  function closePicker(): void {
    if (!pickerOpen) return;
    pickerOpen = false;
    pickerPanel.hidden = true;
    wrap.classList.remove("is-picker");
    input.value = "";
    if (!promptOpen) {
      wrap.hidden = true;
      opts.onClose();
    }
  }

  function closePrompt(): void {
    if (!promptOpen) return;
    promptOpen = false;
    onNumber = undefined;
    onNumberDraft = undefined;
    lastPreviewHtml = "";
    lastAcceptNumber = false;
    promptPanel.hidden = true;
    numberInput.value = "";
    numberInput.hidden = true;
    wrap.classList.remove("is-prompt");
    wrap.classList.remove("has-inline-number");
    wrap.classList.remove("is-typing");
    if (!pickerOpen) {
      wrap.hidden = true;
    }
  }

  function close(): void {
    closePicker();
    closePrompt();
  }

  function paint(): void {
    list.replaceChildren();
    empty.hidden = items.length > 0;
    input.hidden = items.length === 0 && !input.value;
    items.forEach((c, i) => {
      const li = document.createElement("li");
      li.role = "option";
      li.className = i === active ? "is-active" : "";
      li.innerHTML = `<span class="cmd">${escape(c.title)}</span><span class="hint">${escape(c.hint)}</span>`;
      li.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        pick(c.id);
      });
      list.append(li);
    });
  }

  function pick(id: string): void {
    closePicker();
    opts.onPick(id);
  }

  function filter(): void {
    items = filterCommands(opts.getCommands(), input.value);
    active = 0;
    paint();
  }

  function open(): void {
    closePrompt();
    items = filterCommands(opts.getCommands(), "");
    active = 0;
    pickerOpen = true;
    wrap.hidden = false;
    wrap.classList.add("is-picker");
    wrap.classList.remove("is-prompt");
    pickerPanel.hidden = false;
    promptPanel.hidden = true;
    input.value = "";
    paint();
    if (items.length > 0) input.focus();
  }

  function layoutInlineNumber(): void {
    const slot = preview.querySelector<HTMLElement>(".slot.is-number");
    if (!slot || numberInput.hidden) return;
    const typed = numberInput.value;
    slot.textContent = typed || "<radius>";
    slot.dataset.placeholder = typed ? typed : "<radius>";
    const row = preview.parentElement;
    if (!row) return;
    const slotRect = slot.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    numberInput.style.left = `${slotRect.left - rowRect.left}px`;
    numberInput.style.top = `${slotRect.top - rowRect.top}px`;
    numberInput.style.width = `${Math.max(slotRect.width, 1)}px`;
    numberInput.style.height = `${slotRect.height}px`;
  }

  function dockPrompt(prompt: PromptOpts): void {
    closePicker();
    onNumber = prompt.onNumber;
    onNumberDraft = prompt.onNumberDraft;
    const htmlChanged = prompt.previewHtml !== lastPreviewHtml;
    lastPreviewHtml = prompt.previewHtml;
    if (htmlChanged) preview.innerHTML = prompt.previewHtml;
    hintEl.textContent = prompt.hint ?? "";
    const showNumber = prompt.acceptNumber === true;
    const wasNumber = lastAcceptNumber;
    lastAcceptNumber = showNumber;
    numberInput.hidden = !showNumber;
    wrap.classList.toggle("has-inline-number", showNumber);
    wrap.classList.toggle("is-typing", showNumber && numberInput.value.trim() !== "");
    if (showNumber) {
      if (!wasNumber) numberInput.value = prompt.numberValue ?? "";
      else if (prompt.numberValue != null && document.activeElement !== numberInput) {
        numberInput.value = prompt.numberValue;
      }
    } else {
      numberInput.value = "";
    }
    promptOpen = true;
    wrap.hidden = false;
    wrap.classList.add("is-prompt");
    wrap.classList.remove("is-picker");
    promptPanel.hidden = false;
    pickerPanel.hidden = true;
    if (showNumber && htmlChanged) {
      requestAnimationFrame(() => {
        layoutInlineNumber();
        if (document.activeElement !== numberInput) numberInput.focus();
      });
    } else if (showNumber) {
      requestAnimationFrame(layoutInlineNumber);
    }
  }

  function tryCommitNumber(): void {
    if (!onNumber || numberInput.hidden) return;
    const n = parseDraft(numberInput.value);
    if (n == null) return;
    onNumber(n);
  }

  function onPickerKey(e: KeyboardEvent): void {
    if (!pickerOpen) return;
    if (e.key === "Escape") {
      e.preventDefault();
      closePicker();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      active = Math.min(items.length - 1, active + 1);
      paint();
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      active = Math.max(0, active - 1);
      paint();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const c = items[active];
      if (c) pick(c.id);
    }
  }

  function onPromptKey(e: KeyboardEvent): void {
    if (!promptOpen) return;
    if (e.key === "Enter" && e.target === numberInput) {
      e.preventDefault();
      tryCommitNumber();
    }
  }

  input.addEventListener("input", filter);
  wrap.addEventListener("keydown", onPickerKey);
  numberInput.addEventListener("keydown", onPromptKey);
  numberInput.addEventListener("input", () => {
    wrap.classList.toggle("is-typing", numberInput.value.trim() !== "");
    onNumberDraft?.(numberInput.value);
    layoutInlineNumber();
  });
  wrap.addEventListener("pointerdown", (e) => {
    if (e.target === wrap && pickerOpen) closePicker();
  });

  return {
    open,
    dockPrompt,
    closePrompt,
    close,
    isOpen: () => pickerOpen,
    isPromptOpen: () => promptOpen,
    setAnchor(root: HTMLElement) {
      if (wrap.parentElement !== root) root.append(wrap);
    },
    dispose() {
      wrap.remove();
    },
  };
}

function escape(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
