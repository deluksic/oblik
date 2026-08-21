import { For, Show } from "solid-js";

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
import { resolvePaneSlot, sceneViewportError } from "./workspace/resolve-pane-slot";

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
  onWelcomeCreated: (id: string) => void;
  getCommands: () => import("../types.ts").CommandSpec[];
  onFocusPane: (id: string) => void;
  onPickCommand: (id: string) => void;
  onClosePicker: () => void;
  onNumberDraft: (raw: string) => void;
  onCommandBar: (id: string, state: CommandBarState | null) => void;
  onInspect: (id: string, patch: InspectPatch) => void;
  onLiveChange: (id: string) => void;
  onHandle: (id: string, handle: PaneHandle | null) => void;
};

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
            {(id) => {
              const slot = resolvePaneSlot(
                id,
                props.catalog.get(id),
                props.paneMounts.find((m) => m.id === id),
                props.hosts,
                props.loaders,
              );
              if (slot.kind === "error") {
                return <PaneError id={slot.id} label={slot.label} message={slot.message} />;
              }
              const focused = props.focusedId === id;
              return (
                <Pane
                  mount={slot.mount}
                  focused={focused}
                  paletteMode={focused ? props.paletteMode : "closed"}
                  commandBar={focused ? props.commandBar : null}
                  getCommands={props.getCommands}
                  onFocus={() => props.onFocusPane(id)}
                  onPickCommand={props.onPickCommand}
                  onClosePicker={props.onClosePicker}
                  onNumberDraft={props.onNumberDraft}
                  onCommandBar={(state) => props.onCommandBar(id, state)}
                  onInspect={(patch) => props.onInspect(id, patch)}
                  onLiveChange={() => props.onLiveChange(id)}
                  onHandle={(handle) => props.onHandle(id, handle)}
                />
              );
            }}
          </For>
        </div>
      </Show>
    </div>
  );
}
