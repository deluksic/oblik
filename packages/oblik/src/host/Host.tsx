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

export type AnnotationBundle = Record<string, Record<string, Annotation>>;

export type SceneLoaderMap = Record<string, () => Promise<{ default: Scene }>>;

export type OblikMount = {
  setScenes: (scenes: OblikSceneEntry[]) => void;
  setLoaders: (loaders: SceneLoaderMap) => void;
  setAnnotations: (annotations: AnnotationBundle) => void;
  reloadCurrentScene: () => void;
};

export type OblikMountOpts = {
  el: HTMLElement;
  scenes: OblikSceneEntry[];
  loaders: SceneLoaderMap;
  annotations: AnnotationBundle;
};

function pickSceneId(scenes: OblikSceneEntry[]): string {
  const fromUrl = currentSceneId();
  if (fromUrl && scenes.some((s) => s.id === fromUrl && !s.error)) return fromUrl;
  const first = scenes.find((s) => !s.error);
  if (!first) throw new Error("no scenes in catalog");
  return first.id;
}

export function mountOblik(opts: OblikMountOpts): OblikMount {
  const initialSceneId = pickSceneId(opts.scenes);
  if (currentSceneId() !== initialSceneId) openScene(initialSceneId);

  const [scenes, setScenes] = createSignal(opts.scenes);
  const [loaders, setLoaders] = createSignal(opts.loaders);
  const [annotations, setAnnotations] = createSignal(opts.annotations);
  const [reloadTick, setReloadTick] = createSignal(0);

  render(
    () => (
      <Host
        scenes={scenes()}
        loaders={loaders()}
        annotations={annotations()}
        initialSceneId={initialSceneId}
        reloadTick={reloadTick()}
      />
    ),
    opts.el,
  );

  return {
    setScenes,
    setLoaders,
    setAnnotations,
    reloadCurrentScene: () => setReloadTick((t) => t + 1),
  };
}

function Host(props: {
  scenes: OblikSceneEntry[];
  loaders: SceneLoaderMap;
  annotations: AnnotationBundle;
  initialSceneId: string;
  reloadTick: number;
}) {
  const [sceneId, setSceneId] = createSignal(props.initialSceneId);
  const [mod, setMod] = createSignal<Scene | null>(null);
  const [anno, setAnno] = createSignal<Record<string, Annotation>>({});
  const [file, setFile] = createSignal("");
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);

  async function loadScene(id: string) {
    setLoading(true);
    setError(null);
    try {
      const entry = props.scenes.find((s) => s.id === id);
      if (!entry) throw new Error(`Unknown scene "${id}"`);
      if (entry.error) throw new Error(entry.error);
      const loader = props.loaders[sceneLoaderKey(entry.file)];
      if (!loader) throw new Error(`No loader for ${entry.file}`);
      const sceneMod = await loader();
      evaluate(sceneMod.default, { module: entry.path });
      setMod(sceneMod.default);
      setFile(entry.path);
      setAnno(props.annotations[entry.path] ?? {});
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

  createEffect(
    () => [file(), props.annotations] as const,
    ([path, bundle]) => {
      if (path) setAnno(bundle[path] ?? {});
    },
  );

  createEffect(
    () => props.reloadTick,
    (tick) => {
      if (tick === 0) return;
      void loadScene(sceneId());
    },
  );

  onSettled(() => {
    registerSceneHot({
      currentPath: file,
      onHot(scene) {
        const path = file();
        if (!path) return;
        evaluate(scene, { module: path });
        setMod(scene);
      },
    });

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

  return (
    <div class={styles.shell}>
      <header class={styles.head}>
        <div class={styles.headRow}>
          <p class={styles.kicker}>oblik</p>
          <Nav scenes={props.scenes} sceneId={sceneId()} onSelect={selectScene} />
        </div>
        <h1>{mod()?.title ?? "…"}</h1>
        <p>{mod()?.hint}</p>
      </header>
      <div class={styles.stage}>
        <Show when={loading()}>
          <p class={styles.muted}>Loading scene…</p>
        </Show>
        <Show when={!loading() && error()}>
          <p class={styles.err}>{error()}</p>
        </Show>
        <Show when={!loading() && !error() && mod()}>
          {(scene) => (
            <Errored fallback={(err) => <p class={styles.err}>{String(err())}</p>}>
              {scene().kind === "euclid2" ? (
                <Euclid2Pane scene={scene()} file={file()} annotations={anno()} />
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
