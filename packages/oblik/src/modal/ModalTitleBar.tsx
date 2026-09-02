import { Show } from "solid-js";
import type { ParentProps } from "solid-js";
import IconX from "~icons/lucide/x";

import styles from "./ModalTitleBar.module.css";

export type ModalTitleBarProps = {
  /** When provided, renders a close button that calls this on click. */
  onClose?: () => void;
};

export function ModalTitleBar(props: ParentProps<ModalTitleBarProps>) {
  return (
    <header class={styles.bar}>
      <h2 class={styles.title}>{props.children}</h2>
      <Show when={props.onClose}>
        <button
          type="button"
          class={styles.close}
          aria-label="Close"
          onClick={() => props.onClose?.()}
        >
          <IconX class={styles.closeIcon} aria-hidden="true" />
        </button>
      </Show>
    </header>
  );
}
