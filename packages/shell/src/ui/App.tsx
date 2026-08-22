import { createEffect, createMemo, createSignal, Show, untrack } from "solid-js";

import { paneIdsFromAreas, stackedAreas } from "@/layout/grid";
import type {
  CommandBarState,
  InspectPatch,
  InspectState,
  PaneHandle,
  SceneEntry,
  WorkspaceProps,
} from "@/types";

import { Inspect } from "./Inspect";
import { Nav } from "./Nav";
import type { PaletteMode } from "./Palette";
import type { PaneMount } from "./Pane";
import { Viewport } from "./Viewport";
import { singleSceneLayout, WELCOME_INSPECT } from "./workspace/constants";
import { catalogById, currentSceneId, loaderKey, openScene } from "./workspace/model";
import { commandBarSnapshotKey, inspectSnapshotKey } from "./workspace/push-guards";

function inspectForScene(id: string | null, catalog: Map<string, SceneEntry>): InspectState {
  if (id == null) return WELCOME_INSPECT;
  const e = catalog.get(id);
  if (!e) {
    return {
      ...WELCOME_INSPECT,
      status: "Unknown scene",
      error: `No catalog entry for "${id}".`,
    };
  }
  if (e.error) {
    return {
      ...WELCOME_INSPECT,
      status: "Scene catalog error",
      error: e.error,
    };
  }
  return { ...WELCOME_INSPECT, status: "Loading…", error: null };
}

function defaultFocusedId(id: string | null, catalog: Map<string, SceneEntry>): string | null {
  if (!id) return null;
  const e = catalog.get(id);
  if (!e || e.error) return null;
  return e.layout ? (paneIdsFromAreas(e.layout.areas)[0] ?? e.id) : e.id;
}

export function App(props: WorkspaceProps) {
  const [sceneId, setSceneId] = createSignal<string | null>(currentSceneId());
  const catalog = createMemo(() => catalogById(props.scenes));

  const [focusedId, setFocusedId] = createSignal(() =>
    defaultFocusedId(
      sceneId(),
      untrack(() => catalog()),
    ),
  );
  const [pickerOpen, setPickerOpen] = createSignal(() => {
    sceneId();
    return false;
  });
  const [inspectByPane, setInspectByPane] = createSignal((): Record<string, InspectPatch> => {
    sceneId();
    return {};
  });
  const [commandBarByPane, setCommandBarByPane] = createSignal(
    (): Record<string, CommandBarState | null> => {
      sceneId();
      return {};
    },
  );
  const handles = new Map<string, PaneHandle | null>();

  const inspect = createMemo(() => {
    const base = inspectForScene(sceneId(), catalog());
    const id = focusedId();
    if (!id) return base;
    const patch = inspectByPane()[id];
    return patch ? { ...base, ...patch } : base;
  });

  const commandBar = createMemo(() => {
    const id = focusedId();
    return id ? (commandBarByPane()[id] ?? null) : null;
  });

  const paletteMode = createMemo((): PaletteMode => {
    if (commandBar()) return "prompt";
    if (pickerOpen()) return "picker";
    return "closed";
  });

  const title = createMemo(() => {
    const id = sceneId();
    if (!id) return "Welcome";
    const e = catalog().get(id);
    if (!e) return id;
    return e.title;
  });

  createEffect(
    () => title(),
    (nextTitle) => {
      document.title = `euclid — ${nextTitle}`;
    },
  );

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
    () => true,
    () => {
      const onPop = () => setSceneId(currentSceneId());
      window.addEventListener("popstate", onPop);
      return () => window.removeEventListener("popstate", onPop);
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

  async function onWelcomeCreated(id: string, entry: SceneEntry): Promise<void> {
    await props.onSceneCreated?.(entry);
    selectScene(id);
  }

  function registerHandle(id: string, handle: PaneHandle | null): void {
    if (handle) handles.set(id, handle);
    else handles.delete(id);
  }

  function focusPane(id: string): void {
    const prev = focusedId();
    if (prev !== id) {
      handles.get(prev ?? "")?.cancelCommand?.();
      setPickerOpen(false);
    }
    setFocusedId(id);
  }

  function refreshOthers(originId: string): void {
    for (const [id, handle] of handles) {
      if (id !== originId) handle?.refresh({ quiet: true });
    }
  }

  function receiveCommandBar(id: string, state: CommandBarState | null): void {
    setCommandBarByPane((prev) => {
      if (commandBarSnapshotKey(state) === commandBarSnapshotKey(prev[id] ?? null)) return prev;
      return { ...prev, [id]: state };
    });
  }

  function receiveInspect(id: string, patch: InspectPatch): void {
    setInspectByPane((prev) => {
      const cur = prev[id];
      const next = { ...cur, ...patch };
      if (cur && inspectSnapshotKey(next) === inspectSnapshotKey(cur)) return prev;
      return { ...prev, [id]: next };
    });
  }

  function pickCommand(cmdId: string): void {
    setPickerOpen(false);
    const id = focusedId();
    if (!id) return;
    handles.get(id)?.runCommand?.(cmdId);
    document.querySelector<HTMLCanvasElement>(`[data-scene="${id}"] canvas`)?.focus();
  }

  function onWorkspaceKeydown(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      if (paletteMode() === "picker") {
        setPickerOpen(false);
        return;
      }
      if (paletteMode() !== "closed") {
        e.preventDefault();
      }
      handles.get(focusedId() ?? "")?.cancelCommand?.();
      return;
    }

    const t = e.target;
    if (
      t instanceof HTMLInputElement ||
      t instanceof HTMLTextAreaElement ||
      t instanceof HTMLSelectElement
    ) {
      return;
    }

    const bar = commandBar();
    if (paletteMode() === "prompt" && bar) {
      if (e.key === "Tab" && bar.onNextField) {
        e.preventDefault();
        bar.onNextField(e.shiftKey ? -1 : 1);
        return;
      }
    }
    if (paletteMode() === "prompt" && bar?.onNumberDraft) {
      const draft = bar.numberValue ?? "";
      if (bar.acceptNumber && e.key === "Enter") {
        e.preventDefault();
        if (bar.onCommit) {
          bar.onCommit();
          return;
        }
        const trimmed = draft.trim();
        const n = Number(trimmed);
        if (trimmed !== "" && Number.isFinite(n)) {
          bar.onNumber?.(n);
        }
        return;
      }
      if (bar.acceptNumber && e.key === "Backspace") {
        e.preventDefault();
        bar.onNumberDraft(draft === "" ? "" : draft.slice(0, -1));
        return;
      }
      if (bar.acceptNumber && e.key === "Delete") {
        e.preventDefault();
        bar.onNumberDraft(draft === "" ? "" : "");
        return;
      }
      const ident = bar.draftKind === "ident";
      if (e.key.length === 1 && (ident ? /[A-Za-z0-9_]/.test(e.key) : /[0-9.\-]/.test(e.key))) {
        e.preventDefault();
        bar.onNumberDraft(draft + e.key);
        return;
      }
    }

    const isSpace = e.code === "Space" || e.key === " ";
    if (!isSpace || e.repeat || paletteMode() !== "closed") return;
    const id = focusedId();
    if (!id) return;
    const cmds = handles.get(id)?.commands?.() ?? [];
    if (cmds.length === 0) {
      setInspectByPane((prev) => ({
        ...prev,
        [id]: { ...prev[id], status: "Space adds editors on 2D paper. This view has none yet." },
      }));
      return;
    }
    e.preventDefault();
    setPickerOpen(true);
  }

  createEffect(
    () => true,
    () => {
      window.addEventListener("keydown", onWorkspaceKeydown);
      return () => window.removeEventListener("keydown", onWorkspaceKeydown);
    },
  );

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
          onWelcomeCreated={onWelcomeCreated}
          onFocusPane={focusPane}
          onPickCommand={pickCommand}
          onClosePicker={() => setPickerOpen(false)}
          onNumberDraft={(raw) => commandBar()?.onNumberDraft?.(raw)}
          onCommandBar={receiveCommandBar}
          onInspect={receiveInspect}
          onLiveChange={refreshOthers}
          onHandle={registerHandle}
        />
        <Inspect state={inspect()} />
      </div>
    </>
  );
}
