import {
  paneIdsFromAreas,
  stackedAreas,
} from "./layout-grid.ts";
import { mountCommandPalette } from "./palette.ts";
import type { SceneEntry, SceneLayout } from "./types.ts";
import type {
  InspectEls,
  PaneHandle,
  SceneLoaderMap,
  ViewHost,
  ViewKind,
} from "./types.ts";

export type WorkspaceOpts = {
  scenes: SceneEntry[];
  loaders: SceneLoaderMap;
  hosts: Partial<Record<ViewKind, ViewHost>>;
  navRoot: HTMLElement;
  viewportRoot: HTMLElement;
  inspect: InspectEls;
  titleEl: HTMLElement;
};

type MountedPane = {
  id: string;
  handle: PaneHandle | null;
};

function byId(scenes: SceneEntry[]): Map<string, SceneEntry> {
  return new Map(scenes.map((s) => [s.id, s]));
}

function loaderKey(file: string): string {
  return `./scenes/${file}`;
}

function navItems(scenes: SceneEntry[]): SceneEntry[] {
  return [...scenes].sort((a, b) => a.title.localeCompare(b.title));
}

function renderNav(
  nav: HTMLElement,
  scenes: SceneEntry[],
  activeId: string | null,
): void {
  const parts: string[] = [
    `<a href="./" data-scene=""${activeId == null ? ' class="active"' : ""}>Welcome</a>`,
  ];
  for (const s of navItems(scenes)) {
    const href = `?scene=${encodeURIComponent(s.id)}`;
    const on = s.id === activeId ? ' class="active"' : "";
    parts.push(`<span aria-hidden="true">·</span>`);
    parts.push(
      `<a href="${href}" data-scene="${s.id}"${on}>${escapeHtml(s.title)}</a>`,
    );
  }
  nav.innerHTML = parts.join("\n");
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function applyGrid(
  viewport: HTMLElement,
  layout: SceneLayout,
  ids: string[],
): void {
  const columns =
    layout.columns ?? ids.map(() => "minmax(0, 1fr)").join(" ");
  viewport.style.display = "grid";
  viewport.classList.add("shell-viewport");
  viewport.style.gridTemplateAreas = layout.areas;
  viewport.style.gridTemplateColumns = columns;
  if (layout.rows) viewport.style.gridTemplateRows = layout.rows;
  else viewport.style.gridTemplateRows = "minmax(0, 1fr)";
  viewport.style.setProperty("--stack-areas", stackedAreas(ids));
}

function singleLayout(id: string): SceneLayout {
  return { areas: `"${id}"`, columns: "minmax(0, 1fr)" };
}

function showWelcome(
  viewport: HTMLElement,
  titleEl: HTMLElement,
  inspect: InspectEls,
): void {
  viewport.style.display = "block";
  viewport.classList.remove("shell-viewport");
  viewport.style.gridTemplateAreas = "";
  viewport.style.gridTemplateColumns = "";
  viewport.style.gridTemplateRows = "";
  titleEl.textContent = "Welcome";
  document.title = "euclid — Welcome";
  inspect.statusEl.textContent =
    "Open a scene from the nav, or create a new TypeScript file.";
  inspect.errorEl.hidden = true;
  inspect.crumbEl.textContent = "No scene open";
  inspect.metaEl.textContent =
    "A scene is a file in apps/paper/src/scenes. Layouts are CSS grid areas named by scene id.";
  inspect.sourceEl.innerHTML = `<code class="empty">Nothing to inspect until a pane is focused.</code>`;

  viewport.innerHTML = `
    <div class="shell-welcome">
      <h2>Design programs, viewed in scenes</h2>
      <p class="lead">
        Drop a TypeScript file in <code>scenes/</code> and it shows up here.
        Or create one now — a circle and two handles, ready to drag.
      </p>
      <form id="new-scene-form">
        <input
          name="id"
          type="text"
          required
          spellcheck="false"
          autocomplete="off"
          pattern="[a-z][a-z0-9-]*"
          placeholder="hello"
          aria-label="New scene id"
        />
        <button type="submit">New scene</button>
        <p class="form-error" hidden></p>
      </form>
      <p class="hint">Id becomes the filename and the CSS grid area: <code>hello.ts</code> → <code>grid-area: hello</code>.</p>
    </div>
  `;

  const form = viewport.querySelector<HTMLFormElement>("#new-scene-form");
  const errEl = form?.querySelector<HTMLElement>(".form-error");
  form?.addEventListener("submit", (e) => {
    e.preventDefault();
    const input = form.elements.namedItem("id");
    const id =
      input instanceof HTMLInputElement ? input.value.trim().toLowerCase() : "";
    void createScene(id, form.querySelector("button"), errEl);
  });
}

async function createScene(
  id: string,
  button: HTMLButtonElement | null,
  errEl: HTMLElement | null | undefined,
): Promise<void> {
  if (errEl) {
    errEl.hidden = true;
    errEl.textContent = "";
  }
  if (button) button.disabled = true;
  try {
    const res = await fetch("/__create-scene", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    const body = (await res.json()) as { ok?: boolean; error?: string; id?: string };
    if (!res.ok || !body.ok || !body.id) {
      throw new Error(body.error ?? `create failed (${res.status})`);
    }
    location.assign(`?scene=${encodeURIComponent(body.id)}`);
  } catch (err) {
    if (errEl) {
      errEl.hidden = false;
      errEl.textContent = err instanceof Error ? err.message : String(err);
    }
    if (button) button.disabled = false;
  }
}

function errorPane(id: string, message: string): HTMLElement {
  const section = document.createElement("section");
  section.className = "view-pane";
  section.style.gridArea = id;
  section.dataset.scene = id;
  section.innerHTML = `<p class="view-label">${escapeHtml(id)}</p><p class="view-pane-error">${escapeHtml(message)}</p>`;
  return section;
}

export async function startWorkspace(opts: WorkspaceOpts): Promise<void> {
  const { scenes, loaders, hosts, navRoot, viewportRoot, inspect, titleEl } =
    opts;
  const catalog = byId(scenes);
  const sceneParam = new URLSearchParams(location.search).get("scene");
  const activeId =
    sceneParam && sceneParam !== "welcome" ? sceneParam : null;

  renderNav(navRoot, scenes, activeId);

  if (activeId == null) {
    showWelcome(viewportRoot, titleEl, inspect);
    return;
  }

  const entry = catalog.get(activeId);
  if (!entry) {
    titleEl.textContent = activeId;
    document.title = `euclid — ${activeId}`;
    inspect.statusEl.textContent = "Unknown scene";
    inspect.errorEl.hidden = false;
    inspect.errorEl.textContent = `No catalog entry for "${activeId}".`;
    viewportRoot.replaceChildren(
      errorPane(activeId, `No scene file for "${activeId}".`),
    );
    return;
  }

  if (entry.error) {
    titleEl.textContent = entry.title;
    document.title = `euclid — ${entry.title}`;
    inspect.statusEl.textContent = "Scene catalog error";
    inspect.errorEl.hidden = false;
    inspect.errorEl.textContent = entry.error;
    viewportRoot.replaceChildren(errorPane(entry.id, entry.error));
    return;
  }

  const layout = entry.layout ?? singleLayout(entry.id);
  const paneIds = entry.layout
    ? paneIdsFromAreas(entry.layout.areas)
    : [entry.id];

  titleEl.textContent = entry.title;
  document.title = `euclid — ${entry.title}`;
  inspect.statusEl.textContent = "Loading…";
  inspect.errorEl.hidden = true;

  applyGrid(viewportRoot, layout, paneIds);
  viewportRoot.replaceChildren();

  const mounted: MountedPane[] = [];
  let fanOut = false;

  const refreshOthers = (originId: string) => {
    if (fanOut) return;
    fanOut = true;
    try {
      for (const p of mounted) {
        if (p.id !== originId) p.handle?.refresh({ quiet: true });
      }
    } finally {
      fanOut = false;
    }
  };

  let focused = paneIds[0] ?? entry.id;

  for (const id of paneIds) {
    const paneEntry = catalog.get(id);
    if (!paneEntry) {
      viewportRoot.append(errorPane(id, `Unknown scene id "${id}" in layout.`));
      mounted.push({ id, handle: null });
      continue;
    }
    if (paneEntry.error) {
      viewportRoot.append(errorPane(id, paneEntry.error));
      mounted.push({ id, handle: null });
      continue;
    }
    if (!paneEntry.hasScene) {
      viewportRoot.append(
        errorPane(id, `${paneEntry.file} is a layout, not a view.`),
      );
      mounted.push({ id, handle: null });
      continue;
    }
    const host = hosts[paneEntry.view];
    if (!host) {
      viewportRoot.append(
        errorPane(id, `No view host registered for "${paneEntry.view}".`),
      );
      mounted.push({ id, handle: null });
      continue;
    }
    const loader = loaders[loaderKey(paneEntry.file)];
    if (!loader) {
      viewportRoot.append(
        errorPane(id, `No loader for ${paneEntry.file}.`),
      );
      mounted.push({ id, handle: null });
      continue;
    }

    const section = document.createElement("section");
    section.className = "view-pane";
    section.style.gridArea = id;
    section.dataset.scene = id;
    const label = document.createElement("p");
    label.className = "view-label";
    label.textContent = `${paneEntry.view} · ${paneEntry.file}`;
    const canvas = document.createElement("canvas");
    canvas.tabIndex = 0;
    canvas.setAttribute("aria-label", paneEntry.title);
    section.append(label, canvas);
    viewportRoot.append(section);

    const focus = () => {
      focused = id;
      for (const el of viewportRoot.querySelectorAll(".view-pane")) {
        el.classList.toggle(
          "is-focused",
          (el as HTMLElement).dataset.scene === id,
        );
      }
    };
    section.addEventListener("pointerdown", focus);

    try {
      const loaded = (await loader()) as Record<string, unknown>;
      const handle = host.mount(canvas, loaded, {
        sceneId: id,
        sceneFile:
          typeof loaded.sceneFile === "string" ? loaded.sceneFile : paneEntry.file,
        inspect,
        onLiveChange: () => refreshOthers(id),
        onFocus: focus,
      });
      mounted.push({ id, handle });
      if (id === focused) {
        focus();
        handle.refresh();
      } else {
        handle.refresh({ quiet: true });
      }
    } catch (err) {
      section.lastChild?.remove();
      const msg = document.createElement("p");
      msg.className = "view-pane-error";
      msg.textContent = err instanceof Error ? err.message : String(err);
      section.append(msg);
      mounted.push({ id, handle: null });
    }
  }

  const palette = mountCommandPalette({
    root: viewportRoot,
    getCommands: () => {
      const h = mounted.find((p) => p.id === focused)?.handle;
      return h?.commands?.() ?? [];
    },
    onPick: (id) => {
      const pane = mounted.find((p) => p.id === focused);
      pane?.handle?.runCommand?.(id);
      const canvas = viewportRoot.querySelector<HTMLCanvasElement>(
        `.view-pane[data-scene="${focused}"] canvas`,
      );
      canvas?.focus();
    },
    onClose: () => {
      const canvas = viewportRoot.querySelector<HTMLCanvasElement>(
        `.view-pane[data-scene="${focused}"] canvas`,
      );
      canvas?.focus();
    },
  });

  const onKey = (e: KeyboardEvent) => {
    const t = e.target;
    if (
      t instanceof HTMLInputElement ||
      t instanceof HTMLTextAreaElement ||
      t instanceof HTMLSelectElement
    ) {
      return;
    }
    if (e.key === "Escape") {
      if (palette.isOpen()) return;
      mounted.find((p) => p.id === focused)?.handle?.cancelCommand?.();
      return;
    }
    if (e.key !== " " || e.repeat || palette.isOpen()) return;
    e.preventDefault();
    const h = mounted.find((p) => p.id === focused)?.handle;
    const cmds = h?.commands?.() ?? [];
    if (cmds.length === 0) {
      inspect.statusEl.textContent =
        "Space adds editors on 2D paper. This view has none yet.";
      return;
    }
    palette.open();
  };
  window.addEventListener("keydown", onKey);
}
