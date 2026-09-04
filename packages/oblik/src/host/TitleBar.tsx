import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import IconChevronDown from "~icons/lucide/chevron-down";
import IconChevronRight from "~icons/lucide/chevron-right";
import IconSettings from "~icons/lucide/settings";

import { useRequestModal } from "../modal/ModalContext";
import type { OblikSceneEntry } from "../source/catalog";
import { OBLIK_VERSION } from "../version";
import { hasSceneError, navItems } from "./routing";
import { SettingsModal } from "./SettingsModal";

import styles from "./TitleBar.module.css";

export type TitleBarProps = {
  scenes: OblikSceneEntry[];
  /** Current scene id, or `null` on the welcome screen. */
  sceneId: string | null;
  onSelectScene: (id: string) => void;
  onWelcome: () => void;
};

export function TitleBar(props: TitleBarProps) {
  const [menuOpen, setMenuOpen] = createSignal(false);
  const requestModal = useRequestModal();

  const current = createMemo(() =>
    props.sceneId === null ? null : (props.scenes.find((s) => s.id === props.sceneId) ?? null),
  );

  // Close the scene menu on Escape from the capture phase so the panes'
  // bubble-phase Escape handlers (tool/selection) never see it.
  createEffect(
    () => menuOpen(),
    (open) => {
      if (!open) return;
      const onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          setMenuOpen(false);
        }
      };
      window.addEventListener("keydown", onKey, true);
      return () => window.removeEventListener("keydown", onKey, true);
    },
  );

  function closeMenu() {
    setMenuOpen(false);
  }

  function toggleMenu() {
    setMenuOpen((open) => !open);
  }

  function choose(id: string) {
    closeMenu();
    props.onSelectScene(id);
  }

  function openSettings() {
    void requestModal({
      content: ({ respond }) => <SettingsModal respond={respond} />,
    });
  }

  return (
    <div class={styles.bar}>
      <div class={styles.crumbs}>
        <button type="button" class={styles.brand} onClick={props.onWelcome}>
          oblik
        </button>
        <IconChevronRight class={styles.sep} aria-hidden="true" />
        <div class={styles.sceneWrap}>
          <Show
            when={props.sceneId !== null}
            fallback={<span class={styles.welcomeCrumb}>Welcome</span>}
          >
            <button
              type="button"
              class={styles.sceneCrumb}
              aria-haspopup="menu"
              aria-expanded={menuOpen() ? "true" : "false"}
              onPointerDown={(e) => {
                // Toggle at pointer-down: when the menu is open the full-screen
                // backdrop already owns the click, so a click-based toggle would
                // close then instantly re-open (the backdrop unmounts mid-gesture).
                if (e.button === 0) toggleMenu();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  toggleMenu();
                }
              }}
            >
              <span class={styles.sceneTitle}>{current()?.title ?? props.sceneId}</span>
              <IconChevronDown class={styles.caret} aria-hidden="true" />
            </button>
          </Show>
          <Show when={menuOpen()}>
            <div class={styles.backdrop} onPointerDown={closeMenu} />
            <div
              class={styles.menu}
              role="menu"
              aria-label="Scene"
              onPointerDown={(e) => e.stopPropagation()}
            >
              <For each={navItems(props.scenes)}>
                {(scene) => (
                  <button
                    type="button"
                    role="menuitem"
                    class={[styles.item, { [styles.itemCurrent]: scene.id === props.sceneId }]}
                    disabled={hasSceneError(scene)}
                    onClick={() => choose(scene.id)}
                  >
                    <span class={styles.itemTitle}>{scene.title}</span>
                    <Show when={hasSceneError(scene)}>
                      <span class={styles.itemErr}>(error)</span>
                    </Show>
                  </button>
                )}
              </For>
            </div>
          </Show>
        </div>
      </div>
      <div class={styles.actions}>
        <span class={styles.version}>v{OBLIK_VERSION}</span>
        <button type="button" class={styles.settings} aria-label="Settings" onClick={openSettings}>
          <IconSettings class={styles.settingsIcon} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
