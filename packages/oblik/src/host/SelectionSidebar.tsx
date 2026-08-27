import { For } from "solid-js";

import type { OriginDisplayLine, OriginFrame, OriginView, ScopePick, SelectionDetail } from "./selection-detail";

import styles from "./SelectionSidebar.module.css";

export type SelectionSidebarProps = {
  detail: SelectionDetail;
  onPickScope?: (pick: ScopePick) => void;
};

export function SelectionSidebar(props: SelectionSidebarProps) {
  return (
    <aside class={styles.sidebar}>
      <div class={styles.head}>
        <p class={styles.kicker}>Identity</p>
        <h2 class={styles.crumb}>{props.detail.crumb}</h2>
        <p class={styles.meta}>{props.detail.meta}</p>
      </div>
      <p class={styles.kicker}>Origin</p>
      <OriginPane origin={props.detail.origin} onPickScope={props.onPickScope} />
      {props.detail.expose ? (
        <div class={[styles.expose, { [styles.exposeBlocked]: props.detail.expose.kind === "blocked" }]}>
          <p class={styles.kicker}>{props.detail.expose.kind === "blocked" ? "Expose" : "Expose"}</p>
          <p class={styles.exposeText}>{props.detail.expose.text}</p>
        </div>
      ) : null}
    </aside>
  );
}

function OriginPane(props: { origin: OriginView; onPickScope?: (pick: ScopePick) => void }) {
  const empty = () => props.origin.kind === "empty";
  const frames = () => (props.origin.kind === "origin" ? props.origin.frames : []);
  const message = () => (props.origin.kind === "empty" ? props.origin.message : "");
  return (
    <div class={styles.originList}>
      <p class={[styles.emptyOrigin, { [styles.hidden]: !empty() }]}>{message()}</p>
      <For each={frames()}>
        {(frame) => <OriginFrameBox frame={frame} onPickScope={props.onPickScope} />}
      </For>
    </div>
  );
}

function OriginFrameBox(props: {
  frame: OriginFrame;
  onPickScope?: (pick: ScopePick) => void;
}) {
  return (
    <button
      type="button"
      class={[
        styles.originBox,
        {
          [styles.scopeCurrent]: !!props.frame.current,
          [styles.scopePick]: !!props.frame.pick && !props.frame.current,
        },
      ]}
      disabled={!props.frame.pick || props.frame.current || !props.onPickScope}
      onClick={() => {
        const pick = props.frame.pick;
        if (pick && !props.frame.current) props.onPickScope?.(pick);
      }}
    >
      <p class={styles.originFile}>{props.frame.file}</p>
      <div class={styles.quote}>
        <For each={props.frame.lines}>{(row) => <OriginLine row={row} />}</For>
      </div>
    </button>
  );
}
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
