import { For } from "solid-js";

import type { NodeStyle, StyleKind } from "../eval/style";
import {
  defaultStyle,
  isStyleKind,
  setStyleDash,
  setStyleFill,
  setStyleHidden,
  setStyleStroke,
  styleTakesDash,
  styleTakesFill,
  styleTakesStroke,
} from "../eval/style";
import type { OriginDisplayLine, OriginView, SelectionDetail } from "./selection-detail";

import styles from "./SelectionSidebar.module.css";

export type StyleMismatchView = { kind: string; expected?: string };

export type SelectionSidebarProps = {
  detail: SelectionDetail;
  kind?: string;
  style?: NodeStyle;
  mismatch?: StyleMismatchView;
  onStyleChange?: (style: NodeStyle | null) => void;
};

export function SelectionSidebar(props: SelectionSidebarProps) {
  return (
    <aside class={styles.sidebar}>
      <div class={styles.head}>
        <p class={styles.kicker}>Identity</p>
        <h2 class={styles.crumb}>{props.detail.crumb}</h2>
        <p class={styles.meta}>{props.detail.meta}</p>
      </div>
      <StylePane
        kind={props.kind}
        style={props.style}
        mismatch={props.mismatch}
        onStyleChange={props.onStyleChange}
      />
      <p class={styles.kicker}>Origin</p>
      <OriginPane origin={props.detail.origin} />
    </aside>
  );
}

function StylePane(props: {
  kind?: string;
  style?: NodeStyle;
  mismatch?: StyleMismatchView;
  onStyleChange?: (style: NodeStyle | null) => void;
}) {
  const kind = (): StyleKind | null => (props.kind && isStyleKind(props.kind) ? props.kind : null);
  return (
    <div class={[styles.styleBlock, { [styles.hidden]: !kind() }]}>
      <p class={styles.kicker}>Style</p>
      {props.mismatch ? (
        <div class={styles.styleWarn}>
          <p>
            Sheet row is kind <code>{props.mismatch.kind}</code>
            {props.mismatch.expected
              ? ` but this id is a ${props.mismatch.expected}. `
              : " and this id is missing. "}
            Delete the sheet row so it can be rewritten.
          </p>
          <button type="button" class={styles.styleBtn} onClick={() => props.onStyleChange?.(null)}>
            Delete row
          </button>
        </div>
      ) : kind() ? (
        <StyleFields
          style={props.style ?? defaultStyle(kind()!)}
          onChange={(s) => props.onStyleChange?.(s)}
        />
      ) : null}
    </div>
  );
}

function StyleFields(props: { style: NodeStyle; onChange: (style: NodeStyle) => void }) {
  return (
    <div class={styles.styleFields}>
      <label class={styles.styleRow}>
        <input
          type="checkbox"
          checked={props.style.hidden === true}
          onChange={(e) => props.onChange(setStyleHidden(props.style, e.currentTarget.checked))}
        />
        Hidden
      </label>
      {styleTakesStroke(props.style) ? (
        <ColorRow
          label="Stroke"
          value={"stroke" in props.style ? props.style.stroke : undefined}
          fallback="#d7d2c4"
          onChange={(c) => props.onChange(setStyleStroke(props.style, c))}
        />
      ) : null}
      {styleTakesFill(props.style) ? (
        <ColorRow
          label="Fill"
          value={"fill" in props.style ? props.style.fill : undefined}
          fallback="#d7d2c4"
          onChange={(c) => props.onChange(setStyleFill(props.style, c))}
        />
      ) : null}
      {styleTakesDash(props.style) ? (
        <label class={styles.styleRow}>
          <input
            type="checkbox"
            checked={"dash" in props.style && props.style.dash === true}
            onChange={(e) => props.onChange(setStyleDash(props.style, e.currentTarget.checked))}
          />
          Dashed
        </label>
      ) : null}
    </div>
  );
}

function ColorRow(props: {
  label: string;
  value?: string;
  fallback: string;
  onChange: (color: string | undefined) => void;
}) {
  return (
    <div class={styles.colorRow}>
      <span>{props.label}</span>
      <input
        type="color"
        value={props.value ?? props.fallback}
        onInput={(e) => props.onChange(e.currentTarget.value)}
      />
      <button type="button" class={styles.styleBtn} onClick={() => props.onChange(undefined)}>
        Default
      </button>
    </div>
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
