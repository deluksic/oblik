import {
  createMemo,
  createSignal,
  Errored,
  Loading,
  onCleanup,
  runWithOwner,
  Show,
} from "solid-js";

import type { CommandBarState, PaneContext, PaneHandle, ViewHost } from "@/types";

import { Palette, type PaletteMode } from "./Palette";
import { PaneLoading } from "./PaneLoading";

import styles from "./Pane.module.css";

export type PaneMount = {
  id: string;
  entry: import("@/types").SceneEntry;
  host: ViewHost;
  loader: () => Promise<Record<string, unknown>>;
};

export type PaneProps = {
  mount: PaneMount;
  focused: boolean;
  paletteMode: PaletteMode;
  commandBar: CommandBarState | null;
  onFocus: () => void;
  onPickCommand: (id: string) => void;
  onClosePicker: () => void;
  onNumberDraft: (raw: string) => void;
  onCommandBar: PaneContext["onCommandBar"];
  onInspect: PaneContext["onInspect"];
  onLiveChange: () => void;
  onHandle: (handle: PaneHandle | null) => void;
};

function LivePane(props: {
  canvas: HTMLCanvasElement;
  mount: PaneMount;
  paletteMode: PaletteMode;
  commandBar: CommandBarState | null;
  onPickCommand: (id: string) => void;
  onClosePicker: () => void;
  onNumberDraft: (raw: string) => void;
  onCommandBar: PaneContext["onCommandBar"];
  onInspect: PaneContext["onInspect"];
  onLiveChange: () => void;
  onFocus: () => void;
  onHandle: (handle: PaneHandle | null) => void;
}) {
  const handle = createMemo(async () => {
    let current: PaneHandle | null = null;
    onCleanup(() => {
      current?.dispose();
      current = null;
      props.onHandle(null);
    });
    const mount = props.mount;
    const canvas = props.canvas;
    const mod = await mount.loader();
    current = mount.host.mount(canvas, mod, {
      sceneId: mount.id,
      sceneFile: typeof mod.sceneFile === "string" ? mod.sceneFile : mount.entry.file,
      onLiveChange: props.onLiveChange,
      onFocus: props.onFocus,
      onCommandBar: (state) => runWithOwner(null, () => props.onCommandBar?.(state)),
      onInspect: (patch) => runWithOwner(null, () => props.onInspect?.(patch)),
    });
    props.onHandle(current);
    return current;
  });

  return (
    <Show when={handle()}>
      {(h) => (
        <Palette
          mode={props.paletteMode}
          commandBar={props.commandBar}
          commands={() => h().commands?.() ?? []}
          onPick={props.onPickCommand}
          onClosePicker={props.onClosePicker}
          onNumberDraft={props.onNumberDraft}
        />
      )}
    </Show>
  );
}

export function Pane(props: PaneProps) {
  const [canvas, setCanvas] = createSignal<HTMLCanvasElement | null>(null);

  return (
    <section
      class={[styles.pane, { [styles.paneFocused]: props.focused }]}
      style={{ "grid-area": props.mount.id }}
      data-scene={props.mount.id}
      onPointerDown={props.onFocus}
    >
      <p class={styles.label}>
        {props.mount.entry.view} · {props.mount.entry.file}
      </p>
      <div class={styles.view}>
        <canvas
          ref={setCanvas}
          class={styles.canvas}
          tabindex={0}
          aria-label={props.mount.entry.title}
        />
        <Errored fallback={(err) => <p class={styles.error}>{String(err())}</p>}>
          <Loading fallback={<PaneLoading />}>
            <Show when={canvas()}>
              {(el) => (
                <LivePane
                  canvas={el()}
                  mount={props.mount}
                  paletteMode={props.paletteMode}
                  commandBar={props.commandBar}
                  onPickCommand={props.onPickCommand}
                  onClosePicker={props.onClosePicker}
                  onNumberDraft={props.onNumberDraft}
                  onCommandBar={props.onCommandBar}
                  onInspect={props.onInspect}
                  onLiveChange={props.onLiveChange}
                  onFocus={props.onFocus}
                  onHandle={props.onHandle}
                />
              )}
            </Show>
          </Loading>
        </Errored>
      </div>
    </section>
  );
}
