import { Errored, For, Show } from "solid-js";

import type {
  CommandBarState,
  InspectPatch,
  PaneHandle,
  SceneEntry,
  WorkspaceProps,
} from "@/types";

import type { PaletteMode } from "./Palette";
import { Pane, type PaneMount } from "./Pane";
import { PaneError } from "./PaneError";
import { Welcome } from "./Welcome";
import {
  paneResolveFallback,
  resolvePaneSlot,
  sceneViewportError,
} from "./workspace/resolve-pane-slot";

import styles from "./Viewport.module.css";

export type ViewportProps = {
  sceneId: string | null;
  entry: SceneEntry | undefined;
  paneIds: string[];
  gridStyle: Record<string, string>;
  paneMounts: PaneMount[];
  catalog: Map<string, SceneEntry>;
  hosts: WorkspaceProps["hosts"];
  loaders: WorkspaceProps["loaders"];
  focusedId: string | null;
  paletteMode: PaletteMode;
  commandBar: CommandBarState | null;
  inspectByPane: () => Record<string, InspectPatch>;
  onWelcomeCreated: (id: string, entry: SceneEntry) => void | Promise<void>;
  onFocusPane: (id: string) => void;
  onPickCommand: (id: string) => void;
  onClosePicker: () => void;
  onNumberDraft: (raw: string) => void;
  onCommandBar: (id: string, state: CommandBarState | null) => void;
  onInspect: (id: string, patch: InspectPatch) => void;
  onLiveChange: (id: string) => void;
  onHandle: (id: string, handle: PaneHandle | null) => void;
};

type LayoutPaneProps = {
  id: string;
  catalog: Map<string, SceneEntry>;
  paneMounts: PaneMount[];
  hosts: WorkspaceProps["hosts"];
  loaders: WorkspaceProps["loaders"];
  focusedId: string | null;
  paletteMode: PaletteMode;
  commandBar: CommandBarState | null;
  inspectByPane: () => Record<string, InspectPatch>;
  onFocusPane: (id: string) => void;
  onPickCommand: (id: string) => void;
  onClosePicker: () => void;
  onNumberDraft: (raw: string) => void;
  onCommandBar: (id: string, state: CommandBarState | null) => void;
  onInspect: (id: string, patch: InspectPatch) => void;
  onLiveChange: (id: string) => void;
  onHandle: (id: string, handle: PaneHandle | null) => void;
};

function LayoutPane(props: LayoutPaneProps) {
  return (
    <Errored
      fallback={(err) => {
        const { id, label, message } = paneResolveFallback(err(), props.id);
        return <PaneError id={id} label={label} message={message} />;
      }}
    >
      <Pane
        mount={resolvePaneSlot(
          props.id,
          props.catalog.get(props.id),
          props.paneMounts.find((m) => m.id === props.id),
          props.hosts,
          props.loaders,
        )}
        focused={props.focusedId === props.id}
        paletteMode={props.focusedId === props.id ? props.paletteMode : "closed"}
        commandBar={props.focusedId === props.id ? props.commandBar : null}
        status={props.inspectByPane()[props.id]?.status ?? ""}
        error={props.inspectByPane()[props.id]?.error ?? null}
        onFocus={() => props.onFocusPane(props.id)}
        onPickCommand={props.onPickCommand}
        onClosePicker={props.onClosePicker}
        onNumberDraft={props.onNumberDraft}
        onCommandBar={(state) => props.onCommandBar(props.id, state)}
        onInspect={(patch) => props.onInspect(props.id, patch)}
        onLiveChange={() => props.onLiveChange(props.id)}
        onHandle={(handle) => props.onHandle(props.id, handle)}
      />
    </Errored>
  );
}

export function Viewport(props: ViewportProps) {
  return (
    <div id="viewport" class={styles.viewport}>
      <Show when={props.sceneId == null}>
        <Welcome onCreated={props.onWelcomeCreated} />
      </Show>
      <Show when={props.sceneId != null && (!props.entry || props.entry.error)}>
        <PaneError
          id={props.sceneId ?? "scene"}
          label={props.sceneId ?? "scene"}
          message={sceneViewportError(props.sceneId ?? "", props.entry)}
        />
      </Show>
      <Show when={props.sceneId != null && props.entry && !props.entry.error}>
        <div class={styles.viewportGrid} style={props.gridStyle}>
          <For each={props.paneIds}>
            {(id) => (
              <LayoutPane
                id={id}
                catalog={props.catalog}
                paneMounts={props.paneMounts}
                hosts={props.hosts}
                loaders={props.loaders}
                focusedId={props.focusedId}
                paletteMode={props.paletteMode}
                commandBar={props.commandBar}
                inspectByPane={props.inspectByPane}
                onFocusPane={props.onFocusPane}
                onPickCommand={props.onPickCommand}
                onClosePicker={props.onClosePicker}
                onNumberDraft={props.onNumberDraft}
                onCommandBar={props.onCommandBar}
                onInspect={props.onInspect}
                onLiveChange={props.onLiveChange}
                onHandle={props.onHandle}
              />
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
