import { For, Show, createEffect, createMemo, createSignal, onCleanup, untrack } from "solid-js";
import IconChevronDown from "~icons/lucide/chevron-down";
import IconChevronRight from "~icons/lucide/chevron-right";
import IconMoon from "~icons/lucide/moon";
import IconSettings from "~icons/lucide/settings";
import IconSun from "~icons/lucide/sun";

import { useRequestModal } from "../modal/ModalContext";
import type { OblikSceneEntry } from "../source/catalog";
import { OBLIK_VERSION } from "../version";
import { hasSceneError, navItems } from "./routing";
import { SceneKindIcon } from "./SceneKindIcon";
import { SettingsModal } from "./SettingsModal";
import { createStoredSignal } from "./StoredSignalsContext";

import { icon } from "../ui/button.module.css";
import { panel } from "../ui/surface.module.css";
import styles from "./TitleBar.module.css";

export type TitleBarProps = {
  scenes: OblikSceneEntry[];
  /** Current scene id, or `undefined` on the welcome screen. */
  sceneId: string | undefined;
  onSelectScene: (id: string) => void;
  onWelcome: () => void;
};

export function TitleBar(props: TitleBarProps) {
  const [menuOpen, setMenuOpen] = createSignal(false);
  const requestModal = useRequestModal();

  // Theme preference: "system" follows the OS; an explicit light/dark pins it
  // until settings' reset restores "system". Applied synchronously at setup so
  // the first paint already has the right colors.
  const theme = createStoredSignal<"light" | "dark" | "system">("oblik.theme", {
    defaultValue: "system",
  });
  const prefersLight = window.matchMedia("(prefers-color-scheme: light)");

  const resolvedTheme = () =>
    theme.value() === "system" ? (prefersLight.matches ? "light" : "dark") : theme.value();

  const applyTheme = () => {
    document.documentElement.dataset.theme = resolvedTheme();
  };
  // First paint gets the right colors synchronously; the effect keeps it in
  // sync after that, and the matchMedia listener covers system changes.
  document.documentElement.dataset.theme = untrack(resolvedTheme);
  createEffect(resolvedTheme, (t) => {
    document.documentElement.dataset.theme = t;
  });
  const onSystemThemeChange = () => untrack(applyTheme);
  prefersLight.addEventListener("change", onSystemThemeChange);
  onCleanup(() => prefersLight.removeEventListener("change", onSystemThemeChange));

  function toggleTheme() {
    theme.set(resolvedTheme() === "light" ? "dark" : "light");
  }

  const current = createMemo(() =>
    props.sceneId === undefined
      ? undefined
      : (props.scenes.find((s) => s.id === props.sceneId) ?? undefined),
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
      content: (m) => <SettingsModal respond={m.respond} />,
    });
  }

  return (
    <div class={styles.bar}>
      <div class={styles.crumbs}>
        <button type="button" class={styles.brand} onClick={() => props.onWelcome()}>
          oblik
        </button>
        <IconChevronRight class={styles.sep} aria-hidden="true" />
        <div class={styles.sceneWrap}>
          <Show
            when={props.sceneId !== undefined}
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
              <Show
                when={current()}
                fallback={<span class={styles.sceneTitle}>{props.sceneId}</span>}
              >
                {(scene) => (
                  <>
                    <SceneKindIcon kind={scene().kind} class={styles.crumbIcon} />
                    <span class={styles.sceneTitle}>{scene().title}</span>
                  </>
                )}
              </Show>
              <IconChevronDown class={styles.caret} aria-hidden="true" />
            </button>
          </Show>
          <Show when={menuOpen()}>
            <div class={styles.backdrop} onPointerDown={closeMenu} />
            <div
              class={[panel, styles.menu]}
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
                    <span class={styles.itemMain}>
                      <SceneKindIcon kind={scene.kind} class={styles.itemIcon} />
                      <span class={styles.itemTitle}>{scene.title}</span>
                    </span>
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
        <button
          type="button"
          class={icon}
          aria-label={
            resolvedTheme() === "light" ? "Switch to dark theme" : "Switch to light theme"
          }
          onClick={toggleTheme}
        >
          <Show
            when={resolvedTheme() === "light"}
            fallback={<IconSun class={styles.settingsIcon} aria-hidden="true" />}
          >
            <IconMoon class={styles.settingsIcon} aria-hidden="true" />
          </Show>
        </button>
        <button type="button" class={icon} aria-label="Settings" onClick={openSettings}>
          <IconSettings class={styles.settingsIcon} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
