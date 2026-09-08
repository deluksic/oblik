import { Show } from "solid-js";
import type { ParentProps } from "solid-js";

import IconPanelRightClose from "~icons/lucide/panel-right-close";
import IconPanelRightOpen from "~icons/lucide/panel-right-open";

import { createDragHandler } from "../euclid2/view/createDragHandler";
import { icon } from "../ui/button.module.css";
import {
  clampSidebarHeight,
  clampSidebarWidth,
  SIDEBAR_COLLAPSED_STORE_ID,
  SIDEBAR_DEFAULT_HEIGHT,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_HEIGHT_STORE_ID,
  SIDEBAR_STORE_ID,
} from "./resizable";
import { createStoredSignal } from "./StoredSignalsContext";

import styles from "./ResizableSidebar.module.css";

/**
 * Resizable host sidebar. Sits on the right; below the breakpoint in
 * ResizableSidebar.module.css it docks to the bottom of the pane. The two
 * orientations keep separate sizes (width vs height), each a localStorage-backed
 * signal shared by every pane (same id ⇒ same signal) so they persist across
 * scene switches and reloads. Drag math lives in the shared `createDragHandler` —
 * one handler and one handle per orientation, CSS picks which is visible.
 * Collapsed state is a stored signal too: the open button swaps the sidebar for
 * a slim reopen strip, and the preference survives reloads.
 */
export function ResizableSidebar(props: ParentProps) {
  const width = createStoredSignal<number>(SIDEBAR_STORE_ID, {
    defaultValue: SIDEBAR_DEFAULT_WIDTH,
  });
  const height = createStoredSignal<number>(SIDEBAR_HEIGHT_STORE_ID, {
    defaultValue: SIDEBAR_DEFAULT_HEIGHT,
  });
  const collapsed = createStoredSignal<boolean>(SIDEBAR_COLLAPSED_STORE_ID, {
    defaultValue: false,
  });

  const widthDrag = createDragHandler();
  const heightDrag = createDragHandler();

  const startWidthResize = widthDrag.start((e: PointerEvent) => {
    const startX = e.clientX;
    const startWidth = width.value();
    return {
      onPointerMove(ev) {
        width.set(clampSidebarWidth(startWidth - (ev.clientX - startX)));
      },
    };
  });

  const startHeightResize = heightDrag.start((e: PointerEvent) => {
    const startY = e.clientY;
    const startHeight = height.value();
    return {
      onPointerMove(ev) {
        height.set(clampSidebarHeight(startHeight - (ev.clientY - startY)));
      },
    };
  });

  return (
    <Show
      when={!collapsed.value()}
      fallback={
        <div class={styles.collapsed}>
          <button
            type="button"
            class={icon}
            aria-label="Open sidebar"
            onClick={() => collapsed.set(true)}
          >
            <IconPanelRightOpen />
          </button>
        </div>
      }
    >
      <div
        class={styles.slot}
        style={{ "--sidebar-w": `${width.value()}px`, "--sidebar-h": `${height.value()}px` }}
      >
        <div
          class={[
            styles.handle,
            styles.handleSide,
            { [styles.dragging]: widthDrag.phase() !== "not-started" },
          ]}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar width"
          onPointerDown={(e) => startWidthResize(e)}
        />
        <div
          class={[
            styles.handle,
            styles.handleTop,
            { [styles.dragging]: heightDrag.phase() !== "not-started" },
          ]}
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize sidebar height"
          onPointerDown={(e) => startHeightResize(e)}
        />
        <button
          type="button"
          class={[icon, styles.toggle]}
          aria-label="Close sidebar"
          onClick={() => collapsed.set(false)}
        >
          <IconPanelRightClose />
        </button>
        {props.children}
      </div>
    </Show>
  );
}
