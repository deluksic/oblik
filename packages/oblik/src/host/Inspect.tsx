import { For, Show } from "solid-js";

import type { InspectState, OriginDisplayLine, OriginView } from "./inspect";

import styles from "./Inspect.module.css";

export type InspectProps = {
  state: InspectState;
};

export function Inspect(props: InspectProps) {
  return (
    <aside class={styles.inspect}>
      <div class={styles.head}>
        <p class={styles.kicker}>Identity</p>
        <h2 class={styles.crumb}>{props.state.crumb}</h2>
        <p class={styles.meta}>{props.state.meta}</p>
      </div>
      <p class={styles.kicker}>Origin</p>
      <OriginPane origin={props.state.origin} />
    </aside>
  );
}

function OriginPane(props: { origin: OriginView }) {
  const empty = () => props.origin.kind === "empty";
  const frames = () => (props.origin.kind === "origin" ? props.origin.frames : []);
  const message = () => (props.origin.kind === "empty" ? props.origin.message : "");
  return (
    <div class={styles.originList}>
      <p class={[styles.emptyOrigin, { [styles.hidden]: !empty() }]}>{message()}</p>
      <For each={frames()}>
        {(frame) => (
          <div class={styles.originBox}>
            <p class={styles.originFile}>{frame.file}</p>
            <div class={styles.quote}>
              <For each={frame.lines}>{(row) => <OriginLine row={row} />}</For>
            </div>
          </div>
        )}
      </For>
    </div>
  );
}

function OriginLine(props: { row: OriginDisplayLine }) {
  if (props.row.kind === "ellipsis") {
    return (
      <div class={styles.gapRow}>
        <span class={styles.ln} />
        <span class={styles.tx}>...</span>
      </div>
    );
  }
  return (
    <div
      class={{
        [styles.codeRow]: props.row.kind === "code",
        [styles.headerRow]: props.row.kind === "header",
        [styles.current]: props.row.kind === "code" && props.row.current,
      }}
    >
      <span class={styles.ln}>{props.row.line}</span>
      <span class={styles.tx}>{props.row.text || " "}</span>
    </div>
  );
}
