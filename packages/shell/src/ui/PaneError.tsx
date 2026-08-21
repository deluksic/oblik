import styles from "./Pane.module.css";

export type PaneErrorProps = {
  id: string;
  label: string;
  message: string;
};

export function PaneError(props: PaneErrorProps) {
  return (
    <section class={styles.pane} style={{ "grid-area": props.id }} data-scene={props.id}>
      <p class={styles.label}>{props.label}</p>
      <p class={styles.error}>{props.message}</p>
    </section>
  );
}
