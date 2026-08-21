import { createEffect, createMemo, createSignal, For, onSettled, Show } from "solid-js";

import { paneIdsFromAreas, stackedAreas } from "../layout-grid.ts";
import { commandBarSnapshotKey, inspectSnapshotKey } from "../push-guards.ts";
import type {
  CommandBarState,
  InspectPatch,
  InspectState,
  PaneHandle,
  WorkspaceProps,
} from "../types.ts";
import { catalogById, currentSceneId, loaderKey, openScene } from "../workspace-model.ts";
import { Inspect } from "./Inspect.tsx";
import { Nav } from "./Nav.tsx";
import type { PaletteMode } from "./Palette.tsx";
import { Pane, type PaneMount } from "./Pane.tsx";
import { Welcome } from "./Welcome.tsx";

import paneStyles from "./Pane.module.css";
import styles from "./Viewport.module.css";

const WELCOME_INSPECT: InspectState = {
  crumb: "No scene open",
  meta: "A scene is a file in apps/paper/src/scenes. Layouts are CSS grid areas named by scene id.",
  sourceHtml: `<code class="empty">Nothing to inspect until a pane is focused.</code>`,
  status: "Open a scene from the nav, or create a new TypeScript file.",
  error: null,
};

function singleLayout(id: string) {
  return { areas: `"${id}"`, columns: "minmax(0, 1fr)" };
}

export function App(props: WorkspaceProps) {
  const [sceneId, setSceneId] = createSignal<string | null>(currentSceneId());
  const [title, setTitle] = createSignal("Welcome");
  const [inspect, setInspect] = createSignal<InspectState>(WELCOME_INSPECT);
  const [focusedId, setFocusedId] = createSignal<string | null>(null);
  const [paletteMode, setPaletteMode] = createSignal<PaletteMode>("closed");
  const [commandBar, setCommandBar] = createSignal<CommandBarState | null>(null);
  const handles = new Map<string, PaneHandle | null>();
  let lastBarKey = "";
  let lastInspectKey = "";
  let fanOut = false;

  onSettled(() => {
    const onPop = () => setSceneId(currentSceneId());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  });

  const catalog = createMemo(() => catalogById(props.scenes));

  const entry = createMemo(() => {
    const id = sceneId();
    return id ? catalog().get(id) : undefined;
  });

  const paneIds = createMemo(() => {
    const e = entry();
    if (!e || e.error) return [] as string[];
    return e.layout ? paneIdsFromAreas(e.layout.areas) : [e.id];
  });

  const layout = createMemo(() => {
    const e = entry();
    if (!e || e.error) return null;
    return e.layout ?? singleLayout(e.id);
  });

  createEffect(
    () => sceneId(),
    () => {
      setPaletteMode("closed");
      setCommandBar(null);
      lastBarKey = "";
      lastInspectKey = "";
      handles.clear();
      const id = sceneId();
      if (id == null) {
        setTitle("Welcome");
        document.title = "euclid — Welcome";
        setInspect(WELCOME_INSPECT);
        setFocusedId(null);
        return;
      }
      const e = catalog().get(id);
      if (!e) {
        setTitle(id);
        document.title = `euclid — ${id}`;
        setFocusedId(null);
        setInspect({
          ...WELCOME_INSPECT,
          status: "Unknown scene",
          error: `No catalog entry for "${id}".`,
        });
        return;
      }
      if (e.error) {
        setTitle(e.title);
        document.title = `euclid — ${e.title}`;
        setFocusedId(null);
        setInspect({
          ...WELCOME_INSPECT,
          status: "Scene catalog error",
          error: e.error,
        });
        return;
      }
      setTitle(e.title);
      document.title = `euclid — ${e.title}`;
      setFocusedId(e.layout ? (paneIdsFromAreas(e.layout.areas)[0] ?? e.id) : e.id);
      setInspect((prev) => ({ ...prev, status: "Loading…", error: null }));
    },
  );

  const gridStyle = createMemo(() => {
    const l = layout();
    const ids = paneIds();
    if (!l) return {};
    const columns = l.columns ?? ids.map(() => "minmax(0, 1fr)").join(" ");
    return {
      display: "grid",
      "grid-template-areas": l.areas,
      "grid-template-columns": columns,
      "grid-template-rows": l.rows ?? "minmax(0, 1fr)",
      "--stack-areas": stackedAreas(ids),
    } as Record<string, string>;
  });

  function selectScene(id: string | null): void {
    openScene(id);
    setSceneId(id);
  }

  function focusPane(id: string): void {
    if (focusedId() !== id) {
      handles.get(focusedId() ?? "")?.cancelCommand?.();
      setPaletteMode("closed");
      setCommandBar(null);
      lastBarKey = "";
    }
    setFocusedId(id);
  }

  function refreshOthers(originId: string): void {
    if (fanOut) return;
    fanOut = true;
    try {
      for (const [id, handle] of handles) {
        if (id !== originId) handle?.refresh({ quiet: true });
      }
    } finally {
      fanOut = false;
    }
  }

  function receiveCommandBar(id: string, state: CommandBarState | null): void {
    if (id !== focusedId()) return;
    if (!state) {
      if (lastBarKey !== "") {
        lastBarKey = "";
        setCommandBar(null);
        setPaletteMode((mode) => (mode === "prompt" ? "closed" : mode));
      }
      return;
    }
    const key = commandBarSnapshotKey(state);
    if (key === lastBarKey) return;
    lastBarKey = key;
    setCommandBar(state);
    setPaletteMode("prompt");
  }

  function receiveInspect(id: string, patch: InspectPatch): void {
    if (id !== focusedId()) return;
    const key = inspectSnapshotKey(patch);
    if (key === lastInspectKey) return;
    lastInspectKey = key;
    setInspect((prev) => ({ ...prev, ...patch }));
  }

  function getCommands(): import("../types.ts").CommandSpec[] {
    const id = focusedId();
    if (!id) return [];
    return handles.get(id)?.commands?.() ?? [];
  }

  function pickCommand(cmdId: string): void {
    const id = focusedId();
    if (!id) return;
    handles.get(id)?.runCommand?.(cmdId);
    const canvas = document.querySelector<HTMLCanvasElement>(
      `.${paneStyles.pane}[data-scene="${id}"] canvas`,
    );
    canvas?.focus();
  }

  function onNumberDraft(raw: string): void {
    commandBar()?.onNumberDraft?.(raw);
  }

  onSettled(() => {
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
        if (paletteMode() === "picker") {
          setPaletteMode("closed");
          return;
        }
        if (paletteMode() === "prompt") {
          handles.get(focusedId() ?? "")?.cancelCommand?.();
          return;
        }
        handles.get(focusedId() ?? "")?.cancelCommand?.();
        return;
      }
      if (e.key !== " " || e.repeat || paletteMode() !== "closed") return;
      const id = focusedId();
      if (!id) return;
      const cmds = getCommands();
      if (cmds.length === 0) {
        setInspect((prev) => ({
          ...prev,
          status: "Space adds editors on 2D paper. This view has none yet.",
        }));
        return;
      }
      e.preventDefault();
      setPaletteMode("picker");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const paneMounts = createMemo((): PaneMount[] => {
    const ids = paneIds();
    const cat = catalog();
    const mounts: PaneMount[] = [];
    for (const id of ids) {
      const paneEntry = cat.get(id);
      if (!paneEntry?.hasScene) continue;
      const host = props.hosts[paneEntry.view];
      const loader = props.loaders[loaderKey(paneEntry.file)];
      if (!host || !loader) continue;
      mounts.push({ id, entry: paneEntry, host, loader });
    }
    return mounts;
  });

  return (
    <>
      <header>
        <p class="kicker">Prototype 3</p>
        <h1>{title()}</h1>
        <Nav scenes={props.scenes} activeId={sceneId} onSelect={selectScene} />
        <p id="status">{inspect().status}</p>
      </header>
      <Show when={inspect().error}>
        <p id="error">{inspect().error}</p>
      </Show>
      <div id="workspace">
        <div id="viewport" class={styles.viewport}>
          <Show when={sceneId() == null}>
            <Welcome onCreated={(id) => selectScene(id)} />
          </Show>
          <Show when={sceneId() != null && (!entry() || entry()?.error)}>
            <section class={paneStyles.pane}>
              <p class={paneStyles.label}>{sceneId()}</p>
              <p class={paneStyles.error}>
                {!entry() ? `No scene file for "${sceneId()}".` : (entry()?.error ?? "Scene error")}
              </p>
            </section>
          </Show>
          <Show when={sceneId() != null && entry() && !entry()!.error}>
            <div class={styles.viewportGrid} style={gridStyle()}>
              <For each={paneIds()}>
                {(id) => {
                  const paneEntry = catalog().get(id);
                  const mount = paneMounts().find((m) => m.id === id);
                  if (!paneEntry) {
                    return (
                      <section class={paneStyles.pane} style={{ "grid-area": id }} data-scene={id}>
                        <p class={paneStyles.label}>{id}</p>
                        <p class={paneStyles.error}>Unknown scene id "{id}" in layout.</p>
                      </section>
                    );
                  }
                  if (paneEntry.error) {
                    return (
                      <section class={paneStyles.pane} style={{ "grid-area": id }} data-scene={id}>
                        <p class={paneStyles.label}>{id}</p>
                        <p class={paneStyles.error}>{paneEntry.error}</p>
                      </section>
                    );
                  }
                  if (!paneEntry.hasScene) {
                    return (
                      <section class={paneStyles.pane} style={{ "grid-area": id }} data-scene={id}>
                        <p class={paneStyles.label}>{id}</p>
                        <p class={paneStyles.error}>{paneEntry.file} is a layout, not a view.</p>
                      </section>
                    );
                  }
                  if (!mount) {
                    const host = props.hosts[paneEntry.view];
                    const loader = props.loaders[loaderKey(paneEntry.file)];
                    const message = !host
                      ? `No view host registered for "${paneEntry.view}".`
                      : !loader
                        ? `No loader for ${paneEntry.file}.`
                        : "Failed to mount pane.";
                    return (
                      <section class={paneStyles.pane} style={{ "grid-area": id }} data-scene={id}>
                        <p class={paneStyles.label}>{id}</p>
                        <p class={paneStyles.error}>{message}</p>
                      </section>
                    );
                  }
                  return (
                    <Pane
                      mount={mount}
                      focused={() => focusedId() === id}
                      paletteMode={() => (focusedId() === id ? paletteMode() : "closed")}
                      commandBar={() => (focusedId() === id ? commandBar() : null)}
                      getCommands={getCommands}
                      onFocus={() => focusPane(id)}
                      onPickCommand={pickCommand}
                      onClosePicker={() => setPaletteMode("closed")}
                      onNumberDraft={onNumberDraft}
                      onCommandBar={(state) => receiveCommandBar(id, state)}
                      onInspect={(patch) => receiveInspect(id, patch)}
                      onLiveChange={() => refreshOthers(id)}
                      onHandle={(handle) => {
                        handles.set(id, handle);
                      }}
                    />
                  );
                }}
              </For>
            </div>
          </Show>
        </div>
        <Inspect state={inspect} />
      </div>
    </>
  );
}
