import { render } from "@solidjs/web";
import { createEffect, Errored, For, Loading, createMemo, createSignal, onCleanup } from "solid-js";

import { Euclid2Pane } from "../euclid2/Pane";
import { FigurePane } from "../figure/Pane";
import type { FigureScene, Scene } from "../eval/scene";
import type { Annotation } from "../source/analyze";
import type { MentionFile } from "../source/mention";
import {
  sceneLoaderKey,
  mergeAnnotationBundle,
  type DuplicateId,
  type OblikSceneEntry,
} from "../source/catalog";
import { Nav } from "./Nav";
import { currentSceneId, openScene } from "./routing";
import { registerSceneHot } from "./scene-hot";
import { originFileLabel } from "./selection-detail";

import "../theme.css";
import styles from "./Host.module.css";

export type AnnotationBundle = Record<string, Record<string, Annotation>>;
export type MentionBundle = Record<string, MentionFile>;

export type SceneLoaderMap = Record<string, () => Promise<{ default: Scene }>>;

export type OblikMount = {
  setScenes: (scenes: OblikSceneEntry[]) => void;
  setLoaders: (loaders: SceneLoaderMap) => void;
  setAnnotations: (annotations: AnnotationBundle) => void;
  setMentions: (mentions: MentionBundle) => void;
  setCollisions: (collisions: DuplicateId[]) => void;
};

export type OblikMountOpts = {
  el: HTMLElement;
  scenes: OblikSceneEntry[];
  loaders: SceneLoaderMap;
  annotations: AnnotationBundle;
  mentions?: MentionBundle;
  collisions?: DuplicateId[];
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
  const [mentions, setMentions] = createSignal(opts.mentions ?? {});
  const [collisions, setCollisions] = createSignal(opts.collisions ?? []);

  render(
    () => (
      <Host
        scenes={scenes()}
        loaders={loaders()}
        annotations={annotations()}
        mentions={mentions()}
        collisions={collisions()}
        initialSceneId={initialSceneId}
      />
    ),
    opts.el,
  );

  return { setScenes, setLoaders, setAnnotations, setMentions, setCollisions };
}

function Host(props: {
  scenes: OblikSceneEntry[];
  loaders: SceneLoaderMap;
  annotations: AnnotationBundle;
  mentions: MentionBundle;
  collisions: DuplicateId[];
  initialSceneId: string;
}) {
  const [sceneId, setSceneId] = createSignal(props.initialSceneId);
  const sceneCache = new Map<string, Scene>();
  const [sceneRev, setSceneRev] = createSignal(0);

  const entry = createMemo(() => props.scenes.find((s) => s.id === sceneId()) ?? null);

  const loaded = createMemo(async () => {
    sceneRev();
    const e = entry();
    const loaders = props.loaders;
    if (!e) throw new Error(`Unknown scene "${sceneId()}"`);
    if (e.error) throw new Error(e.error);
    const key = sceneLoaderKey(e.file);
    const cached = sceneCache.get(key);
    if (cached) return cached;
    const loader = loaders[key];
    if (!loader) throw new Error(`No loader for ${e.file}`);
    let cancelled = false;
    onCleanup(() => {
      cancelled = true;
    });
    const sceneMod = await loader();
    if (cancelled) return sceneMod.default;
    sceneCache.set(key, sceneMod.default);
    return sceneMod.default;
  });

  const scene = createMemo(() => loaded());
  const sceneKind = createMemo(() => scene().kind);

  const annotations = createMemo(() => mergeAnnotationBundle(props.annotations));

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
    if (!e) return <p class={styles.err}>Unknown scene</p>;
    if (sceneKind() === "figure") {
      return (
        <FigurePane
          scene={scene() as FigureScene}
          file={e.path}
          annotations={annotations()}
          mentions={Object.values(props.mentions)}
        />
      );
    }
    return sceneKind() === "euclid2" ? (
      <Euclid2Pane
        scene={scene()}
        file={e.path}
        annotations={annotations()}
        mentions={Object.values(props.mentions)}
      />
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
          <p>{scene().hint}</p>
        </Loading>
      </header>
      <For each={props.collisions}>
        {(dup) => (
          <div class={styles.dupWarn} role="alert">
            <p>
              Duplicate id <code class={styles.dupId}>{dup.id}</code>. Delete the colliding trailing
              ids so stamp can regenerate unique ones.
            </p>
            <ul class={styles.dupSites}>
              <For each={dup.sites}>
                {(s) => (
                  <li>
                    {originFileLabel(s.file)}:{s.line}
                  </li>
                )}
              </For>
            </ul>
          </div>
        )}
      </For>
      <div class={styles.stage}>
        <Errored fallback={(err) => <p class={styles.err}>{String(err())}</p>}>
          <Loading fallback={<p class={styles.muted}>Loading scene…</p>}>{pane()}</Loading>
        </Errored>
      </div>
    </div>
  );
}
