import { render } from "@solidjs/web";
import {
  createEffect,
  Errored,
  For,
  Loading,
  createMemo,
  createSignal,
  onCleanup,
  Show,
} from "solid-js";

import { Euclid2Pane } from "../euclid2/Pane";
import type { Euclid2Scene, FigureScene, Scene } from "../eval/scene";
import { FigurePane } from "../figure/Pane";
import { Modal } from "../modal/Modal";
import type { Annotation } from "../source/analyze";
import {
  sceneLoaderKey,
  mergeAnnotationBundle,
  type DuplicateId,
  type OblikSceneEntry,
} from "../source/catalog";
import type { MentionFile } from "../source/mention";
import { currentSceneId, openScene, openWelcome } from "./routing";
import { registerSceneHot } from "./scene-hot";
import { originFileLabel } from "./selection-detail";
import { StoredSignalsProvider } from "./StoredSignalsContext";
import { TitleBar } from "./TitleBar";
import { Welcome } from "./Welcome";

import "../theme/reset.css";
import "../theme/index.css";
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

/**
 * Resolve the scene to open on mount. `undefined` means welcome (no `?scene=`).
 * A URL scene id wins when it exists; otherwise fall back to the first scene
 * without a catalog error, or welcome when nothing is openable.
 */
function pickSceneId(scenes: OblikSceneEntry[]): string | undefined {
  const fromUrl = currentSceneId();
  if (fromUrl) {
    if (scenes.some((s) => s.id === fromUrl && !s.error)) return fromUrl;
    return scenes.find((s) => !s.error)?.id ?? undefined;
  }
  return undefined;
}

export function mountOblik(opts: OblikMountOpts): OblikMount {
  const initialSceneId = pickSceneId(opts.scenes);
  if (initialSceneId) {
    if (currentSceneId() !== initialSceneId) openScene(initialSceneId);
  } else if (currentSceneId() !== undefined) {
    openWelcome();
  }

  const [scenes, setScenes] = createSignal(opts.scenes);
  const [loaders, setLoaders] = createSignal(opts.loaders);
  const [annotations, setAnnotations] = createSignal(opts.annotations);
  const [mentions, setMentions] = createSignal(opts.mentions ?? {});
  const [collisions, setCollisions] = createSignal(opts.collisions ?? []);

  render(
    () => (
      <StoredSignalsProvider>
        <Modal>
          <Host
            scenes={scenes()}
            loaders={loaders()}
            annotations={annotations()}
            mentions={mentions()}
            collisions={collisions()}
            initialSceneId={initialSceneId}
          />
        </Modal>
      </StoredSignalsProvider>
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
  initialSceneId: string | undefined;
}) {
  // Function-form initializer: reading `props` eagerly to seed a signal is not
  // valid in Solid 2 (see docs/prototypes/6.md) — `() => props.x` reads it in
  // a reactive scope and only resets if the value actually changes.
  const [sceneId, setSceneId] = createSignal<string | undefined>(() => props.initialSceneId);
  const sceneCache = new Map<string, Scene>();
  const [sceneRev, setSceneRev] = createSignal(0);

  const isWelcome = createMemo(() => sceneId() === undefined);

  const entry = createMemo(() => props.scenes.find((s) => s.id === sceneId()) ?? undefined);

  const loaded = createMemo(async () => {
    sceneRev();
    const e = entry();
    const loaders = props.loaders;
    // Deleted scene, not an error: a throw here would escape the <Errored>
    // boundary (memos recompute in the flush queue, outside its scope) and
    // halt the whole reactive system. The pane renders a "deleted" notice.
    if (!e) return undefined;
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

  // NOTE (Solid 2): `pane`/`sceneKind` are only ever evaluated when a scene is
  // open (the welcome `<Show>` short-circuits them). Branch identity on the
  // stable `sceneKind` memo so a scene is not remounted when only props change.
  const scene = createMemo(() => loaded());
  const sceneKind = createMemo(() => scene()?.kind);

  const annotations = createMemo(() => mergeAnnotationBundle(props.annotations));

  createEffect(
    () => true,
    () => {
      registerSceneHot({
        onHot(key, hotScene) {
          sceneCache.set(key, hotScene);
          setSceneRev((r) => r + 1);
        },
      });
      return () => registerSceneHot(undefined);
    },
  );

  createEffect(
    () => 1,
    () => {
      const onPop = () => setSceneId(currentSceneId());
      window.addEventListener("popstate", onPop);
      return () => window.removeEventListener("popstate", onPop);
    },
  );

  function selectScene(id: string) {
    openScene(id);
    setSceneId(id);
  }

  function goWelcome() {
    openWelcome();
    setSceneId(undefined);
  }

  const pane = createMemo(() => {
    const e = entry();
    if (!e) return <p class={styles.err}>Scene deleted</p>;
    const kind = sceneKind();
    const file = e.path;
    if (kind === "figure") {
      return (
        <FigurePane
          scene={scene() as FigureScene}
          file={file}
          annotations={annotations()}
          mentions={Object.values(props.mentions)}
        />
      );
    }
    if (kind === "euclid2") {
      return (
        <Euclid2Pane
          scene={scene() as Euclid2Scene}
          file={file}
          annotations={annotations()}
          mentions={Object.values(props.mentions)}
        />
      );
    }
    return <p class={styles.err}>Unknown scene kind</p>;
  });

  return (
    <div class={styles.shell}>
      <header class={styles.head}>
        <TitleBar
          scenes={props.scenes}
          sceneId={sceneId()}
          onSelectScene={selectScene}
          onWelcome={goWelcome}
        />
        <Show when={!isWelcome()}>
          <Loading fallback={undefined}>
            <p>{scene()?.hint}</p>
          </Loading>
        </Show>
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
        <Show
          when={!isWelcome()}
          fallback={<Welcome scenes={props.scenes} onSelectScene={selectScene} />}
        >
          <Errored fallback={(err) => <p class={styles.err}>{String(err())}</p>}>
            <Loading fallback={<p class={styles.muted}>Loading scene…</p>}>{pane()}</Loading>
          </Errored>
        </Show>
      </div>
    </div>
  );
}
