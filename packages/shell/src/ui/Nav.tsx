import { For } from "solid-js";

import type { SceneEntry } from "../types.ts";
import { navItems, sceneHref } from "../workspace-model.ts";

import styles from "./Nav.module.css";

export type NavProps = {
  scenes: SceneEntry[];
  activeId: () => string | null;
  onSelect: (id: string | null) => void;
};

export function Nav(props: NavProps) {
  return (
    <nav class={styles.nav} aria-label="Scene">
      <a
        href={sceneHref(null)}
        class={[styles.link, { [styles.linkActive]: props.activeId() == null }]}
        onClick={(e) => {
          e.preventDefault();
          props.onSelect(null);
        }}
      >
        Welcome
      </a>
      <select
        name="scene"
        aria-label="Select Scene"
        class={styles.select}
        value={props.activeId() ?? ""}
        onChange={(e) => {
          const next = e.currentTarget.value || null;
          if (next) props.onSelect(next);
        }}
      >
        <option value="" disabled={props.activeId() != null}>
          Select Scene
        </option>
        <For each={navItems(props.scenes)}>
          {(scene) => <option value={scene.id}>{scene.title}</option>}
        </For>
      </select>
    </nav>
  );
}
