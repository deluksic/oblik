import { createEffect, createMemo, createSignal, Errored, getOwner, Loading, Show } from "solid-js";

import type { CommandBarState, PaneContext, PaneHandle, ViewHost } from "@/types";

import { Palette, type PaletteMode } from "./Palette";

import styles from "./Pane.module.css";

export type PaneMount = {
  id: string;
  entry: import("@/types").SceneEntry;
  host: ViewHost;
  loader: () => Promise<unknown>;
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

type HostSnap = {
  canvas: HTMLCanvasElement;
  mod: Record<string, unknown>;
  mount: PaneMount;
};

/** Host `mount()` / `refresh()` run in effect apply; delay shell writes until unowned. */
function fromHost(fn: () => void): void {
  if (getOwner()) queueMicrotask(fn);
  else fn();
}

function MountedHost(props: {
  mod: Record<string, unknown>;
  canvas: HTMLCanvasElement;
  mount: PaneMount;
  onLiveChange: () => void;
  onFocus: () => void;
  onCommandBar: PaneContext["onCommandBar"];
  onInspect: PaneContext["onInspect"];
  onHandle: (handle: PaneHandle | null) => void;
  setHandle: (handle: PaneHandle | null) => void;
}) {
  const snap: { current: HostSnap | null } = { current: null };

  createEffect(
    () => {
      const canvas = props.canvas;
      const mod = props.mod;
      const mount = props.mount;
      snap.current = { canvas, mod, mount };
      return `${mount.id}\0${mount.entry.file}`;
    },
    (key) => {
      if (!key) return;
      const current = snap.current;
      if (!current) return;
      const { canvas, mod, mount } = current;
      const handle = mount.host.mount(canvas, mod, {
        sceneId: mount.id,
        sceneFile: typeof mod.sceneFile === "string" ? mod.sceneFile : mount.entry.file,
        onLiveChange: () => fromHost(() => props.onLiveChange()),
        onFocus: () => fromHost(() => props.onFocus()),
        onCommandBar: (state) => fromHost(() => props.onCommandBar?.(state)),
        onInspect: (patch) => fromHost(() => props.onInspect?.(patch)),
      });
      props.setHandle(handle);
      props.onHandle(handle);
      return () => {
        handle.dispose();
        props.setHandle(null);
        props.onHandle(null);
      };
    },
  );

  return null;
}

export function Pane(props: PaneProps) {
  const mod = createMemo(() => props.mount.loader() as Promise<Record<string, unknown>>);
  const [canvas, setCanvas] = createSignal<HTMLCanvasElement | null>(null);
  const [handle, setHandle] = createSignal<PaneHandle | null>(null, {
    ownedWrite: true,
  });

  function commands() {
    return handle()?.commands?.() ?? [];
  }

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
      <canvas
        ref={setCanvas}
        class={styles.canvas}
        tabindex={0}
        aria-label={props.mount.entry.title}
      />
      <Errored fallback={(err) => <p class={styles.error}>{String(err())}</p>}>
        <Loading fallback={<p class={styles.error}>Loading…</p>}>
          <Show when={canvas()}>
            {(el) => (
              <MountedHost
                mod={mod()}
                canvas={el()}
                mount={props.mount}
                onLiveChange={props.onLiveChange}
                onFocus={props.onFocus}
                onCommandBar={props.onCommandBar}
                onInspect={props.onInspect}
                onHandle={props.onHandle}
                setHandle={setHandle}
              />
            )}
          </Show>
        </Loading>
      </Errored>
      <Palette
        mode={props.paletteMode}
        commandBar={props.commandBar}
        commands={commands}
        onPick={props.onPickCommand}
        onClosePicker={props.onClosePicker}
        onNumberDraft={props.onNumberDraft}
      />
    </section>
  );
}
