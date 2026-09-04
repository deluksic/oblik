import { Show, createSignal } from "solid-js";
import IconTrash from "~icons/lucide/trash-2";

import { ModalTitleBar } from "../modal/ModalTitleBar";
import { OBLIK_VERSION } from "../version";
import { useStoredSignals } from "./StoredSignalsContext";

import styles from "./SettingsModal.module.css";

export type SettingsModalProps = {
  respond: (value: void) => void;
};

export function SettingsModal(props: SettingsModalProps) {
  const { resetAll } = useStoredSignals();
  const [armed, setArmed] = createSignal(false);

  function confirmReset() {
    resetAll();
    props.respond();
  }

  return (
    <div class={styles.wrap}>
      <ModalTitleBar onClose={() => props.respond()}>Settings</ModalTitleBar>

      <section class={styles.section}>
        <h3 class={styles.sectionTitle}>About</h3>
        <div class={styles.row}>
          <span class={styles.rowLabel}>oblik</span>
          <code class={styles.version}>v{OBLIK_VERSION}</code>
        </div>
      </section>

      <section class={styles.section}>
        <h3 class={styles.sectionTitle}>Local data</h3>
        <p class={styles.note}>
          Settings such as the sidebar width are persisted in this browser's localStorage.
        </p>
        <Show
          when={!armed()}
          fallback={
            <div class={styles.armBox}>
              <p class={styles.confirmNote}>
                Clear every key on this origin and restore defaults? This cannot be undone.
              </p>
              <div class={styles.btnRow}>
                <button type="button" class={styles.secondary} onClick={() => setArmed(false)}>
                  Cancel
                </button>
                <button type="button" class={styles.danger} onClick={confirmReset}>
                  Clear all local data
                </button>
              </div>
            </div>
          }
        >
          <button type="button" class={styles.resetBtn} onClick={() => setArmed(true)}>
            <IconTrash class={styles.resetIcon} aria-hidden="true" />
            Reset all local data
          </button>
        </Show>
      </section>
    </div>
  );
}
