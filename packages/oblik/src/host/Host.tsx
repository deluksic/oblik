import { render } from "@solidjs/web";
import { Errored, Loading, createMemo, createSignal, onSettled } from "solid-js";

import { Euclid2Pane } from "../euclid2/Pane";
import type { Scene } from "../eval/scene";
import type { Annotation } from "../source/analyze";
import { sceneLoaderKey, type OblikSceneEntry } from "../source/catalog";
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
  const [hot, setHot] = createSignal<Scene | null>(() => {
    sceneId();
    props.loaders;
    return null;
  });

  const entry = createMemo(() => props.scenes.find((s) => s.id === sceneId()) ?? null);

  const loaded = createMemo(async () => {
    const e = entry();
    const loaders = props.loaders;
    if (!e) throw new Error(`Unknown scene "${sceneId()}"`);
    if (e.error) throw new Error(e.error);
    const loader = loaders[sceneLoaderKey(e.file)];
    if (!loader) throw new Error(`No loader for ${e.file}`);
    const sceneMod = await loader();
    return sceneMod.default;
  });

  const anno = createMemo(() => {
    const path = entry()?.path;
    return path ? (props.annotations[path] ?? {}) : {};
  });

  onSettled(() => {
    registerSceneHot({
      currentPath: () => entry()?.path ?? "",
      onHot(scene) {
        setHot(scene);
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

  const scene = createMemo(() => hot() ?? loaded());
  const sceneKind = createMemo(() => scene().kind);

  const pane = createMemo(() => {
    const e = entry();
    if (!e) return <p class={styles.err}>Unknown scene</p>;
    return sceneKind() === "euclid2" ? (
      <Euclid2Pane scene={scene()} file={e.path} annotations={anno()} />
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
          <p>{(hot() ?? loaded())?.hint}</p>
        </Loading>
      </header>
      <div class={styles.stage}>
        <Errored fallback={(err) => <p class={styles.err}>{String(err())}</p>}>
          <Loading fallback={<p class={styles.muted}>Loading scene…</p>}>{pane()}</Loading>
        </Errored>
      </div>
    </div>
  );
}
