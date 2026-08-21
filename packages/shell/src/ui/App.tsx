import { createEffect, createMemo, createSignal, onSettled, Show } from "solid-js";

import { paneIdsFromAreas, stackedAreas } from "@/layout/grid";
import type { CommandBarState, InspectPatch, PaneHandle, WorkspaceProps } from "@/types";

import { Inspect } from "./Inspect";
import { Nav } from "./Nav";
import type { PaletteMode } from "./Palette";
import type { PaneMount } from "./Pane";
import { Viewport } from "./Viewport";
import { singleSceneLayout, WELCOME_INSPECT } from "./workspace/constants";
import { catalogById, currentSceneId, loaderKey, openScene } from "./workspace/model";
import { commandBarSnapshotKey, inspectSnapshotKey } from "./workspace/push-guards";

export function App(props: WorkspaceProps) {
  const [sceneId, setSceneId] = createSignal<string | null>(currentSceneId());
  const [title, setTitle] = createSignal("Welcome");
  const [inspect, setInspect] = createSignal(WELCOME_INSPECT);
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
    return e.layout ?? singleSceneLayout(e.id);
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
    document.querySelector<HTMLCanvasElement>(`[data-scene="${id}"] canvas`)?.focus();
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
      if (getCommands().length === 0) {
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

  return (
    <>
      <header>
        <p class="kicker">Prototype 3</p>
        <h1>{title()}</h1>
        <Nav scenes={props.scenes} activeId={sceneId()} onSelect={selectScene} />
        <p id="status">{inspect().status}</p>
      </header>
      <Show when={inspect().error}>
        <p id="error">{inspect().error}</p>
      </Show>
      <div id="workspace">
        <Viewport
          sceneId={sceneId()}
          entry={entry()}
          paneIds={paneIds()}
          gridStyle={gridStyle()}
          paneMounts={paneMounts()}
          catalog={catalog()}
          hosts={props.hosts}
          loaders={props.loaders}
          focusedId={focusedId()}
          paletteMode={paletteMode()}
          commandBar={commandBar()}
          onWelcomeCreated={selectScene}
          getCommands={getCommands}
          onFocusPane={focusPane}
          onPickCommand={pickCommand}
          onClosePicker={() => setPaletteMode("closed")}
          onNumberDraft={(raw) => commandBar()?.onNumberDraft?.(raw)}
          onCommandBar={receiveCommandBar}
          onInspect={receiveInspect}
          onLiveChange={refreshOthers}
          onHandle={(id, handle) => {
            handles.set(id, handle);
          }}
        />
        <Inspect state={inspect()} />
      </div>
    </>
  );
}
