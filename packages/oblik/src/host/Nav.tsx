import { For } from "solid-js";

import type { OblikSceneEntry } from "../source/catalog";
import { navItems } from "./routing";
import styles from "./Nav.module.css";

export type NavProps = {
  scenes: OblikSceneEntry[];
  sceneId: string;
  onSelect: (id: string) => void;
};

export function Nav(props: NavProps) {
  return (
    <nav class={styles.nav} aria-label="Scene">
      <select
        name="scene"
        aria-label="Select scene"
        class={styles.select}
        value={props.sceneId}
        onChange={(e) => {
          const next = e.currentTarget.value;
          if (next) props.onSelect(next);
        }}
      >
        <For each={navItems(props.scenes)}>
          {(scene) => (
            <option value={scene.id} disabled={scene.error != null}>
              {scene.error ? `${scene.title} (${scene.error})` : scene.title}
            </option>
          )}
        </For>
      </select>
    </nav>
  );
}
