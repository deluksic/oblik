import type { InspectState } from "../types.ts";

import styles from "./Inspect.module.css";

export type InspectProps = {
  state: () => InspectState;
};

export function Inspect(props: InspectProps) {
  return (
    <aside class={styles.inspect}>
      <p class={styles.kicker}>Identity</p>
      <h2 class={styles.crumb}>{props.state().crumb}</h2>
      <p class={styles.meta}>{props.state().meta}</p>
      <p class={styles.kicker}>Creation site</p>
      <div class={styles.source} innerHTML={props.state().sourceHtml} />
    </aside>
  );
}
