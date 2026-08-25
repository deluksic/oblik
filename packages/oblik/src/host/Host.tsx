import { Errored, Show, createEffect, createSignal, onSettled } from "solid-js";
import { render } from "@solidjs/web";

import { evaluate } from "../eval/evaluate";
import type { Scene } from "../eval/scene";
import { Euclid2Pane } from "../euclid2/Pane";
import type { Annotation } from "../source/analyze";
import {
  sceneLoaderKey,
  type OblikSceneEntry,
} from "../source/catalog";
import { Nav } from "./Nav";
import { currentSceneId, openScene } from "./routing";
import { registerSceneHot } from "./scene-hot";
import styles from "./Host.module.css";

export type SceneLoaderMap = Record<string, () => Promise<{ default: Scene }>>;

export type OblikMount = {
  setScenes: (scenes: OblikSceneEntry[]) => void;
  setLoaders: (loaders: SceneLoaderMap) => void;
  reloadCurrentScene: () => Promise<void>;
};

export type OblikMountOpts = {
  el: HTMLElement;
  scenes: OblikSceneEntry[];
  loaders: SceneLoaderMap;
};

function pickSceneId(scenes: OblikSceneEntry[]): string {
  const fromUrl = currentSceneId();
  if (fromUrl && scenes.some((s) => s.id === fromUrl && !s.error)) return fromUrl;
  const first = scenes.find((s) => !s.error);
  if (!first) throw new Error("no scenes in catalog");
  return first.id;
}

export function mountOblik(opts: OblikMountOpts): OblikMount {
  const startId = pickSceneId(opts.scenes);
  if (currentSceneId() !== startId) openScene(startId);

  const [scenes, setScenes] = createSignal(opts.scenes);
  const [loaders, setLoaders] = createSignal(opts.loaders);
  const [sceneId, setSceneId] = createSignal(startId);
  const [mod, setMod] = createSignal<Scene | null>(null);
  const [anno, setAnno] = createSignal<Record<string, Annotation>>({});
  const [file, setFile] = createSignal("");
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);

  async function loadScene(id: string) {
    setLoading(true);
    setError(null);
    try {
      const entry = scenes().find((s) => s.id === id);
      if (!entry) throw new Error(`Unknown scene "${id}"`);
      if (entry.error) throw new Error(entry.error);
      const loader = loaders()[sceneLoaderKey(entry.file)];
      if (!loader) throw new Error(`No loader for ${entry.file}`);
      const sceneMod = await loader();
      const annMod = await import(/* @vite-ignore */ `virtual:oblik-annotations?file=${entry.path}`);
      evaluate(sceneMod.default, { module: entry.path });
      setMod(sceneMod.default);
      setAnno(annMod.default ?? {});
      setFile(entry.path);
    } catch (err) {
      setMod(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  createEffect(
    () => sceneId(),
    (id) => {
      void loadScene(id);
    },
  );

  registerSceneHot({
    currentPath: file,
    onHot(scene) {
      const path = file();
      if (!path) return;
      evaluate(scene, { module: path });
      setMod(scene);
      void import(/* @vite-ignore */ `virtual:oblik-annotations?file=${path}`).then((m) =>
        setAnno(m.default ?? {}),
      );
    },
  });

  onSettled(() => {
    const onPop = () => {
      const id = currentSceneId();
      if (id && id !== sceneId()) setSceneId(id);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  });

  function selectScene(id: string) {
    openScene(id);
    setSceneId(id);
  }

  render(
    () => (
      <Host
        scenes={scenes()}
        sceneId={sceneId()}
        mod={mod()}
        anno={anno()}
        file={file()}
        loading={loading()}
        error={error()}
        onSelect={selectScene}
      />
    ),
    opts.el,
  );

  return {
    setScenes,
    setLoaders,
    reloadCurrentScene: () => loadScene(sceneId()),
  };
}

function Host(props: {
  scenes: OblikSceneEntry[];
  sceneId: string;
  mod: Scene | null;
  anno: Record<string, Annotation>;
  file: string;
  loading: boolean;
  error: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div class={styles.shell}>
      <header class={styles.head}>
        <div class={styles.headRow}>
          <p class={styles.kicker}>oblik</p>
          <Nav scenes={props.scenes} sceneId={props.sceneId} onSelect={props.onSelect} />
        </div>
        <h1>{props.mod?.title ?? "…"}</h1>
        <p>{props.mod?.hint}</p>
      </header>
      <div class={styles.stage}>
        <Show when={props.loading}>
          <p class={styles.muted}>Loading scene…</p>
        </Show>
        <Show when={!props.loading && props.error}>
          <p class={styles.err}>{props.error}</p>
        </Show>
        <Show when={!props.loading && !props.error && props.mod}>
          {(scene) => (
            <Errored fallback={(err) => <p class={styles.err}>{String(err())}</p>}>
              {scene().kind === "euclid2" ? (
                <Euclid2Pane scene={scene()} file={props.file} annotations={props.anno} />
              ) : (
                <p class={styles.err}>Unknown scene kind</p>
              )}
            </Errored>
          )}
        </Show>
      </div>
    </div>
  );
}
