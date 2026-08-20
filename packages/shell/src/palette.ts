import type { CommandSpec } from "./types.ts";

export type { CommandSpec };

export function filterCommands(
  commands: readonly CommandSpec[],
  query: string,
): CommandSpec[] {
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

export function mountCommandPalette(opts: PaletteOpts): {
  open: () => void;
  close: () => void;
  isOpen: () => boolean;
  dispose: () => void;
} {
  const wrap = document.createElement("div");
  wrap.className = "shell-palette";
  wrap.hidden = true;
  wrap.innerHTML = `
    <div class="shell-palette-panel" role="dialog" aria-label="Add editor">
      <input type="search" class="shell-palette-input" placeholder="Point, distance…" autocomplete="off" spellcheck="false" />
      <ul class="shell-palette-list" role="listbox"></ul>
      <p class="shell-palette-empty" hidden>No editors to add in this view.</p>
    </div>
  `;
  opts.root.append(wrap);

  const input = wrap.querySelector<HTMLInputElement>(".shell-palette-input")!;
  const list = wrap.querySelector<HTMLUListElement>(".shell-palette-list")!;
  const empty = wrap.querySelector<HTMLElement>(".shell-palette-empty")!;

  let items: CommandSpec[] = [];
  let active = 0;
  let openState = false;

  function close(): void {
    if (!openState) return;
    openState = false;
    wrap.hidden = true;
    input.value = "";
    opts.onClose();
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
    wrap.hidden = true;
    openState = false;
    input.value = "";
    opts.onPick(id);
  }

  function filter(): void {
    items = filterCommands(opts.getCommands(), input.value);
    active = 0;
    paint();
  }

  function open(): void {
    items = filterCommands(opts.getCommands(), "");
    active = 0;
    openState = true;
    wrap.hidden = false;
    input.value = "";
    paint();
    if (items.length > 0) input.focus();
  }

  function onKey(e: KeyboardEvent): void {
    if (!openState) return;
    if (e.key === "Escape") {
      e.preventDefault();
      close();
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

  input.addEventListener("input", filter);
  wrap.addEventListener("keydown", onKey);
  wrap.addEventListener("pointerdown", (e) => {
    if (e.target === wrap) close();
  });

  return {
    open,
    close,
    isOpen: () => openState,
    dispose() {
      wrap.remove();
    },
  };
}

function escape(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
