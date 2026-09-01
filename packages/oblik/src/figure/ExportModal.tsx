import { Show, createSignal } from "solid-js";

import IconClipboard from "~icons/lucide/clipboard-copy";
import IconDownload from "~icons/lucide/download";

import { ModalTitleBar } from "../modal/ModalTitleBar";

import styles from "./ExportModal.module.css";

export type ExportModalProps = {
  svg: string;
  width: number;
  height: number;
  filename: string;
  empty: boolean;
  respond: (value: void) => void;
};

export function ExportModal(props: ExportModalProps) {
  const [copied, setCopied] = createSignal(false);
  const dataUrl = () => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(props.svg)}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(props.svg);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }

  function download() {
    const blob = new Blob([props.svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = props.filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div class={styles.wrap}>
      <ModalTitleBar onClose={() => props.respond()}>Export figure</ModalTitleBar>
      <p class={styles.meta}>
        SVG · {props.width}×{props.height}px · <code class={styles.name}>{props.filename}</code>
      </p>
      <div class={styles.preview}>
        <Show
          when={!props.empty}
          fallback={
            <p class={styles.empty}>Nothing painted yet — use the Brush to add ink, then export.</p>
          }
        >
          <img class={styles.image} src={dataUrl()} alt="Figure export preview" />
        </Show>
      </div>
      <footer class={styles.footer}>
        <button type="button" class={styles.secondary} onClick={() => props.respond()}>
          Close
        </button>
        <span class={styles.spacer} />
        <button
          type="button"
          class={styles.secondary}
          disabled={props.empty}
          onClick={() => void copy()}
        >
          <IconClipboard class={styles.btnIcon} aria-hidden="true" />
          {copied() ? "Copied!" : "Copy SVG"}
        </button>
        <button type="button" class={styles.primary} disabled={props.empty} onClick={download}>
          <IconDownload class={styles.btnIcon} aria-hidden="true" />
          Download .svg
        </button>
      </footer>
    </div>
  );
}
