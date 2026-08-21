import styles from "./PaneLoading.module.css";

export function PaneLoading() {
  return (
    <div class={styles.loading} role="status" aria-label="Loading">
      <span class={styles.dot} />
      <span class={styles.dot} />
      <span class={styles.dot} />
    </div>
  );
}
