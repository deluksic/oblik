import type { ParentProps } from "solid-js";

import { createDragHandler } from "../euclid2/view/createDragHandler";
import { clampSidebarWidth, SIDEBAR_DEFAULT_WIDTH, SIDEBAR_STORE_ID } from "./resizable";
import { createStoredSignal } from "./StoredSignalsContext";

import styles from "./ResizableSidebar.module.css";

/**
 * Resizable host sidebar. The width is a localStorage-backed signal shared by
 * every pane (same id ⇒ same signal), so the chosen width persists across scene
 * switches and reloads. Drag math lives in the shared `createDragHandler`.
 */
export function ResizableSidebar(props: ParentProps) {
  const width = createStoredSignal<number>(SIDEBAR_STORE_ID, {
    defaultValue: SIDEBAR_DEFAULT_WIDTH,
  });
  const drag = createDragHandler();

  const startResize = drag.start((e: PointerEvent) => {
    const startX = e.clientX;
    const startWidth = width.value();
    return {
      onPointerMove(ev) {
        width.set(clampSidebarWidth(startWidth - (ev.clientX - startX)));
      },
    };
  });

  return (
    <div class={styles.slot} style={{ width: `${width.value()}px` }}>
      <div
        class={[styles.handle, { [styles.dragging]: drag.phase() !== "not-started" }]}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        onPointerDown={(e) => startResize(e)}
      />
      {props.children}
    </div>
  );
}
