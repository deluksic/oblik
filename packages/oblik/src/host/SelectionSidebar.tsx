import { For, Show } from "solid-js";
import type { ParentProps } from "solid-js";

import {
  EMPTY_SELECTION_DETAIL,
  type ExposeNote,
  type OriginDisplayLine,
  type OriginFrame,
  type OriginView,
  type ScopePick,
  type SelectionDetail,
} from "./selection-detail";

import { kicker } from "../ui/surface.module.css";
import styles from "./SelectionSidebar.module.css";

export type SelectionSidebarProps = {
  /** Convenience: when no children are provided, render the default node/scope inspector. */
  detail?: SelectionDetail;
  onPickScope?: (pick: ScopePick) => void;
  onExpose?: (bind: string) => void;
  onOpenFile?: (file: string, line: number) => void;
};

/**
 * Sidebar shell. By default (no children) it renders the shared node/scope
 * inspector from `detail` — this keeps existing callers unchanged. Scene panes
 * that need bespoke panels can instead pass children and compose the exported
 * pieces (`SelectionInspector`, `SidebarIdentity`, `Origin`, `SidebarExpose`,
 * `SidebarSection`) alongside their own sections.
 */
export function SelectionSidebar(props: ParentProps<SelectionSidebarProps>) {
  return (
    <aside class={styles.sidebar}>
      {props.children ?? (
        <SelectionInspector
          detail={props.detail}
          onPickScope={props.onPickScope}
          onExpose={props.onExpose}
          onOpenFile={props.onOpenFile}
        />
      )}
    </aside>
  );
}

/** The default node/scope inspection: identity + origin source + optional expose. */
export function SelectionInspector(props: {
  detail?: SelectionDetail;
  onPickScope?: (pick: ScopePick) => void;
  onExpose?: (bind: string) => void;
  onOpenFile?: (file: string, line: number) => void;
}) {
  const detail = () => props.detail ?? EMPTY_SELECTION_DETAIL;
  return (
    <>
      <SidebarIdentity crumb={detail().crumb} meta={detail().meta} />
      <p class={[kicker, styles.kicker]}>Origin</p>
      <Origin origin={detail().origin} onPickScope={props.onPickScope} onOpenFile={props.onOpenFile} />
      <Show when={detail().expose}>
        {(note) => <SidebarExpose note={note()} onExpose={props.onExpose} />}
      </Show>
    </>
  );
}

/** Identity header block: kicker + crumb + meta. */
export function SidebarIdentity(props: { crumb: string; meta: string }) {
  return (
    <div class={styles.head}>
      <p class={[kicker, styles.kicker]}>Identity</p>
      <h2 class={styles.crumb}>{props.crumb}</h2>
      <p class={styles.meta}>{props.meta}</p>
    </div>
  );
}

/** A labeled, non-growing section (kicker title + arbitrary content). */
export function SidebarSection(props: ParentProps<{ title: string }>) {
  return (
    <div class={styles.section}>
      <p class={[kicker, styles.kicker]}>{props.title}</p>
      {props.children}
    </div>
  );
}

/** Source-quote list with scope-dive picking. Reusable across scene kinds. */
export function Origin(props: {
  origin: OriginView;
  onPickScope?: (pick: ScopePick) => void;
  onOpenFile?: (file: string, line: number) => void;
}) {
  const empty = () => props.origin.kind === "empty";
  const frames = () => (props.origin.kind === "origin" ? props.origin.frames : []);
  const message = () => (props.origin.kind === "empty" ? props.origin.message : "");
  return (
    <div class={styles.originList}>
      <p class={[styles.emptyOrigin, { [styles.hidden]: !empty() }]}>{message()}</p>
      <For each={frames()}>
        {(frame) => (
          <OriginFrameBox frame={frame} onPickScope={props.onPickScope} onOpenFile={props.onOpenFile} />
        )}
      </For>
    </div>
  );
}

/** "Add to return" hint/blocked note. */
export function SidebarExpose(props: { note: ExposeNote; onExpose?: (bind: string) => void }) {
  const canAdd = () => props.note.kind === "hint" && !!props.note.bind && !!props.onExpose;
  return (
    <div class={[styles.expose, { [styles.exposeBlocked]: props.note.kind === "blocked" }]}>
      <p class={[kicker, styles.kicker]}>Return bag</p>
      <p class={styles.exposeText}>{props.note.text}</p>
      {canAdd() ? (
        <button
          type="button"
          class={styles.exposeBtn}
          onClick={() => {
            const bind = props.note.bind;
            if (bind) props.onExpose?.(bind);
          }}
        >
          Add to return
        </button>
      ) : undefined}
    </div>
  );
}

function OriginFrameBox(props: {
  frame: OriginFrame;
  onPickScope?: (pick: ScopePick) => void;
  onOpenFile?: (file: string, line: number) => void;
}) {
  // Guarded click instead of `disabled`: a disabled button swallows clicks on
  // its descendants, which would block the line-number open affordance inside.
  const canDive = () => !!props.frame.pick && !props.frame.current && !!props.onPickScope;
  return (
    <button
      type="button"
      class={[
        styles.originBox,
        {
          [styles.scopeCurrent]: !!props.frame.current,
          [styles.scopePick]: canDive(),
        },
      ]}
      aria-disabled={canDive() ? "false" : "true"}
      onClick={() => {
        const pick = props.frame.pick;
        if (pick && !props.frame.current && props.onPickScope) props.onPickScope(pick);
      }}
    >
      <p class={styles.originFile}>{props.frame.file}</p>
      <div class={styles.quote}>
        <For each={props.frame.lines}>
          {(row) => <OriginLine row={row} file={props.frame.file} onOpenFile={props.onOpenFile} />}
        </For>
      </div>
    </button>
  );
}

function OriginLine(props: {
  row: OriginDisplayLine;
  file: string;
  onOpenFile?: (file: string, line: number) => void;
}) {
  const openLine = (line: number) => (e: MouseEvent) => {
    e.stopPropagation();
    props.onOpenFile?.(props.file, line);
  };
  return (
    <>
      {props.row.kind === "ellipsis" ? (
        <div class={styles.gapRow}>
          <span class={styles.ln} />
          <span class={styles.tx}>...</span>
        </div>
      ) : (
        <div
          class={{
            [styles.codeRow]: props.row.kind === "code",
            [styles.headerRow]: props.row.kind === "header",
            [styles.current]: !!props.row.current,
          }}
        >
          <Show
            when={props.onOpenFile}
            fallback={<span class={styles.ln}>{props.row.line}</span>}
          >
            <span
              class={[styles.ln, styles.lnOpen]}
              title="Open in editor"
              onClick={openLine(props.row.line)}
            >
              {props.row.line}
            </span>
          </Show>
          <span class={styles.tx}>{props.row.text || " "}</span>
        </div>
      )}
    </>
  );
}
