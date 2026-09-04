import { For, Show, createMemo, createSignal } from "solid-js";
import IconSearch from "~icons/lucide/search";

import type { OblikSceneEntry } from "../source/catalog";
import { hasSceneError, navItems } from "./routing";
import { SceneKindIcon } from "./SceneKindIcon";

import styles from "./Welcome.module.css";

export type WelcomeProps = {
  scenes: OblikSceneEntry[];
  onSelectScene: (id: string) => void;
};

export function Welcome(props: WelcomeProps) {
  const [query, setQuery] = createSignal("");

  const scenes = createMemo(() => navItems(props.scenes));

  const shown = createMemo(() => {
    const q = query().trim().toLowerCase();
    if (!q) return scenes();
    return scenes().filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.file.toLowerCase().includes(q) ||
        s.path.toLowerCase().includes(q),
    );
  });

  return (
    <div class={styles.wrap}>
      <div class={styles.panel}>
        <header class={styles.head}>
          <h1 class={styles.logo}>oblik</h1>
          <p class={styles.tag}>Design scenes — pick one to open</p>
          <p class={styles.count}>
            {scenes().length} {scenes().length === 1 ? "scene" : "scenes"}
          </p>
        </header>
        <div class={styles.searchBox}>
          <IconSearch class={styles.searchIcon} aria-hidden="true" />
          <input
            type="search"
            class={styles.search}
            placeholder="Filter scenes…"
            aria-label="Filter scenes"
            autocomplete="off"
            spellcheck={false}
            value={query()}
            onInput={(e) => setQuery(e.currentTarget.value)}
          />
        </div>
        <Show when={shown().length > 0} fallback={<p class={styles.empty}>No scenes match.</p>}>
          <ul class={styles.list}>
            <For each={shown()}>
              {(scene) => (
                <li class={styles.rowWrap}>
                  <button
                    type="button"
                    class={styles.row}
                    disabled={hasSceneError(scene)}
                    onClick={() => props.onSelectScene(scene.id)}
                  >
                    <SceneKindIcon kind={scene.kind} class={styles.rowIcon} />
                    <span class={styles.rowBody}>
                      <span class={styles.rowTitle}>{scene.title}</span>
                      <Show
                        when={hasSceneError(scene)}
                        fallback={<span class={styles.rowMeta}>{scene.path}</span>}
                      >
                        <span class={styles.rowError}>{scene.error}</span>
                      </Show>
                    </span>
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </div>
    </div>
  );
}
