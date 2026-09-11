import { render } from "@solidjs/web";
import { createEffect, Errored, For, Loading, createMemo, createSignal, Show } from "solid-js";

import { Euclid2Pane } from "../euclid2/Pane";
import { createVisitCaches } from "../eval/scene-cache";
import type { Scene } from "../eval/scene";
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
import { batchHmr } from "./hmr-batch";
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

  const scene = createMemo(() => {
    sceneRev();
    const e = entry();
    // Deleted or errored scenes are terminal; the pane renders a notice.
    if (!e || e.error) return undefined;
    const key = sceneLoaderKey(e.file);
    const cached = sceneCache.get(key);
    // Cache hits return synchronously so the scene lands in the same flush as
    // the HMR signal writes; a pending memo would settle a microtask later,
    // forcing a second world re-run per scene edit.
    if (cached) return cached;
    const loader = props.loaders[key];
    // Catalog knows the scene but the loaders HMR has not landed yet. Park the
    // memo on a never-settling flight — the runtime's own pending machinery —
    // instead of throwing NotReadyError: a hand-made one has no source node,
    // and the runtime turns that into a fatal reactivity halt. The memo
    // retries when props.loaders (a dependency read above) changes.
    if (!loader) return new Promise<Scene>(() => {});
    return loader().then((sceneMod) => {
      sceneCache.set(key, sceneMod.default);
      return sceneMod.default;
    });
  });

  // NOTE (Solid 2): `pane`/`sceneKind` are only ever evaluated when a scene is
  // open (the welcome `<Show>` short-circuits them). `sceneKind` picks the pane,
  // and neither the pane nor the view is remounted when the scene module is
  // replaced — see `visitCaches` below.
  const sceneKind = createMemo(() => scene()?.kind);

  /**
   * One set of caches per visit. Navigation changes `sceneId`, so this memo hands
   * out a fresh store and the previous visit's computation is dropped — without
   * touching the mounted view, and without a reset call anywhere.
   */
  const visitCaches = createMemo(() => {
    sceneId();
    return createVisitCaches();
  });

  const annotations = createMemo(() => mergeAnnotationBundle(props.annotations));

  // Read eagerly here (memo), but only reference the memo lazily inside the
  // `pane` memo's JSX. The pane memo must keep its identity across annotation /
  // mention bundle refreshes (every scene edit invalidates them), otherwise it
  // returns a new <Euclid2Pane> and the pane — and its camera — remounts.
  const mentionsList = createMemo(() => Object.values(props.mentions));

  createEffect(
    () => true,
    () => {
      registerSceneHot({
        onHot(key, hotScene) {
          batchHmr(() => {
            sceneCache.set(key, hotScene);
            setSceneRev((r) => r + 1);
          });
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

  // Catalog refreshes replace the scenes array with structurally equal entry
  // objects (any scene added/edited rescans the whole catalog). The pane memo
  // must therefore branch only on primitive derivations of `entry` — reading
  // the entry object here would return a fresh <Euclid2Pane> on every catalog
  // change and remount the pane, killing the view's camera.
  const sceneDeleted = createMemo(() => entry() === undefined);
  const sceneError = createMemo(() => entry()?.error);
  const sceneFile = createMemo(() => entry()?.path);

  /**
   * The scene *module* once its import has landed, and nothing while it is still
   * pending. An HMR re-import replaces this object; `visitCaches` keys the
   * visit's entries on it, so the memo is replaced while the view — and its
   * camera — stays mounted.
   */
  const sceneModule = createMemo(() => {
    const loaded = scene();
    return loaded instanceof Promise ? undefined : loaded;
  });
  const figureScene = createMemo(() => {
    const loaded = sceneModule();
    return loaded?.kind === "figure" ? loaded : undefined;
  });
  const euclid2Scene = createMemo(() => {
    const loaded = sceneModule();
    return loaded?.kind === "euclid2" ? loaded : undefined;
  });

  const pane = createMemo(() => {
    if (sceneDeleted()) return <p class={styles.err}>Scene deleted</p>;
    const err = sceneError();
    if (err) return <p class={styles.err}>{err}</p>;
    const kind = sceneKind();
    if (kind === "figure") {
      return (
        <Show when={figureScene()}>
          {(loaded) => (
            <FigurePane
              scene={loaded()}
              file={sceneFile() ?? ""}
              annotations={annotations()}
              mentions={mentionsList()}
              caches={visitCaches()}
            />
          )}
        </Show>
      );
    }
    if (kind === "euclid2") {
      return (
        <Show when={euclid2Scene()}>
          {(loaded) => (
            <Euclid2Pane
              scene={loaded()}
              file={sceneFile() ?? ""}
              annotations={annotations()}
              mentions={mentionsList()}
              caches={visitCaches()}
            />
          )}
        </Show>
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
