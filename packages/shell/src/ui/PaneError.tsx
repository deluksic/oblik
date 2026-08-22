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
      <div class={styles.view}>
        <p class={styles.error}>{props.message}</p>
      </div>
    </section>
  );
}
