import { createSignal, onSettled, Show } from "solid-js";

import type { CommandBarState, PaneContext, PaneHandle, SceneEntry, ViewHost } from "@/types";

import { Palette, type PaletteMode } from "./Palette";

import styles from "./Pane.module.css";

export type PaneMount = {
  id: string;
  entry: SceneEntry;
  host: ViewHost;
  loader: () => Promise<unknown>;
};

export type PaneProps = {
  mount: PaneMount;
  focused: boolean;
  paletteMode: PaletteMode;
  commandBar: CommandBarState | null;
  getCommands: () => import("../types.ts").CommandSpec[];
  onFocus: () => void;
  onPickCommand: (id: string) => void;
  onClosePicker: () => void;
  onNumberDraft: (raw: string) => void;
  onCommandBar: PaneContext["onCommandBar"];
  onInspect: PaneContext["onInspect"];
  onLiveChange: () => void;
  onHandle: (handle: PaneHandle | null) => void;
};

export function Pane(props: PaneProps) {
  const [loadError, setLoadError] = createSignal<string | null>(null);
  const canvasRef = { current: null as HTMLCanvasElement | null };
  let handle: PaneHandle | null = null;

  onSettled(() => {
    void (async () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      setLoadError(null);
      try {
        const loaded = (await props.mount.loader()) as Record<string, unknown>;
        handle = props.mount.host.mount(canvas, loaded, {
          sceneId: props.mount.id,
          sceneFile:
            typeof loaded.sceneFile === "string" ? loaded.sceneFile : props.mount.entry.file,
          onLiveChange: props.onLiveChange,
          onFocus: props.onFocus,
          onCommandBar: props.onCommandBar,
          onInspect: props.onInspect,
        });
        props.onHandle(handle);
        if (props.focused) {
          props.onFocus();
          handle.refresh();
        } else {
          handle.refresh({ quiet: true });
        }
      } catch (err) {
        props.onHandle(null);
        setLoadError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      handle?.dispose?.();
      handle = null;
      props.onHandle(null);
    };
  });

  return (
    <section
      class={[styles.pane, { [styles.paneFocused]: props.focused }]}
      style={{ "grid-area": props.mount.id }}
      data-scene={props.mount.id}
      onPointerDown={() => props.onFocus()}
    >
      <p class={styles.label}>
        {props.mount.entry.view} · {props.mount.entry.file}
      </p>
      <Show when={!loadError()} fallback={<p class={styles.error}>{loadError()}</p>}>
        <canvas
          ref={(el) => {
            canvasRef.current = el;
          }}
          class={styles.canvas}
          tabIndex={0}
          aria-label={props.mount.entry.title}
        />
      </Show>
      <Palette
        mode={props.paletteMode}
        commandBar={props.commandBar}
        getCommands={props.getCommands}
        onPick={props.onPickCommand}
        onClosePicker={props.onClosePicker}
        onNumberDraft={props.onNumberDraft}
      />
    </section>
  );
}
