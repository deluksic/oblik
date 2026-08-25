import { render } from "@solidjs/web";
import { createEffect, Loading, createMemo, createSignal } from "solid-js";

import { Euclid2Pane } from "../euclid2/Pane";
import type { Scene } from "../eval/scene";
import type { Annotation } from "../source/analyze";
import { sceneLoaderKey, type OblikSceneEntry } from "../source/catalog";
import { Nav } from "./Nav";
import { currentSceneId, openScene } from "./routing";
import { registerSceneHot } from "./scene-hot";

import "../theme.css";
import styles from "./Host.module.css";

export type AnnotationBundle = Record<string, Record<string, Annotation>>;

export type SceneLoaderMap = Record<string, () => Promise<{ default: Scene }>>;

export type OblikMount = {
  setScenes: (scenes: OblikSceneEntry[]) => void;
  setLoaders: (loaders: SceneLoaderMap) => void;
  setAnnotations: (annotations: AnnotationBundle) => void;
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

  render(
    () => (
      <Host
        scenes={scenes()}
        loaders={loaders()}
        annotations={annotations()}
        initialSceneId={initialSceneId}
      />
    ),
    opts.el,
  );

  return { setScenes, setLoaders, setAnnotations };
}

function Host(props: {
  scenes: OblikSceneEntry[];
  loaders: SceneLoaderMap;
  annotations: AnnotationBundle;
  initialSceneId: string;
}) {
  const [sceneId, setSceneId] = createSignal(props.initialSceneId);
  const sceneCache = new Map<string, Scene>();
  const [sceneRev, setSceneRev] = createSignal(0);

  const entry = createMemo(() => props.scenes.find((s) => s.id === sceneId()) ?? null);
  const [loadedScene, setLoadedScene] = createSignal<Scene | undefined>(undefined);
  const [loadErr, setLoadErr] = createSignal<unknown>(undefined);

  createEffect(() => {
    sceneRev();
    const e = entry();
    const loaders = props.loaders;
    if (!e) {
      setLoadedScene(undefined);
      setLoadErr(new Error(`Unknown scene "${sceneId()}"`));
      return;
    }
    if (e.error) {
      setLoadedScene(undefined);
      setLoadErr(new Error(e.error));
      return;
    }
    const key = sceneLoaderKey(e.file);
    const cached = sceneCache.get(key);
    if (cached) {
      setLoadedScene(cached);
      setLoadErr(undefined);
      return;
    }
    const loader = loaders[key];
    if (!loader) {
      setLoadedScene(undefined);
      setLoadErr(new Error(`No loader for ${e.file}`));
      return;
    }
    setLoadedScene(undefined);
    let active = true;
    void loader().then((sceneMod) => {
      if (!active) return;
      sceneCache.set(key, sceneMod.default);
      setLoadedScene(sceneMod.default);
      setLoadErr(undefined);
    });
    return () => {
      active = false;
    };
  });

  const anno = createMemo(() => {
    const path = entry()?.path;
    return path ? (props.annotations[path] ?? {}) : {};
  });

  createEffect(
    () => true,
    () => {
      registerSceneHot({
        onHot(key, scene) {
          sceneCache.set(key, scene);
          setSceneRev((r) => r + 1);
        },
      });
      return () => registerSceneHot(null);
    },
  );

  createEffect(
    () => 1,
    () => {
      const onPop = () => {
        const id = currentSceneId();
        if (id && id !== sceneId()) setSceneId(id);
      };
      window.addEventListener("popstate", onPop);
      return () => window.removeEventListener("popstate", onPop);
    },
  );

  function selectScene(id: string) {
    openScene(id);
    setSceneId(id);
  }

  const pane = createMemo(() => {
    const e = entry();
    const s = loadedScene();
    if (!e) return <p class={styles.err}>Unknown scene</p>;
    if (!s) return null;
    return s.kind === "euclid2" ? (
      <Euclid2Pane scene={s} file={e.path} annotations={anno()} />
    ) : (
      <p class={styles.err}>Unknown scene kind</p>
    );
  });

  return (
    <div class={styles.shell}>
      <header class={styles.head}>
        <div class={styles.headRow}>
          <p class={styles.kicker}>oblik</p>
          <Nav scenes={props.scenes} sceneId={sceneId()} onSelect={selectScene} />
        </div>
        <h1>{entry()?.title ?? "…"}</h1>
        <Loading fallback={null}>
          <p>{loadedScene()?.hint}</p>
        </Loading>
      </header>
      <div class={styles.stage}>
        {loadErr() ? (
          <p class={styles.err}>{String(loadErr())}</p>
        ) : (
          <Loading fallback={<p class={styles.muted}>Loading scene…</p>}>{pane()}</Loading>
        )}
      </div>
    </div>
  );
}
