import { Portal } from "@solidjs/web";
import { For, createEffect, createSignal } from "solid-js";
import type { ParentProps } from "solid-js";

import {
  ModalContext,
  type ModalConfig,
  type ModalResponse,
} from "./ModalContext";

import { panel } from "../ui/surface.module.css";
import styles from "./Modal.module.css";

/**
 * One open dialog. The response type is erased here — the promise `requestModal`
 * returns is what keeps `T` — so `dismiss` is a method (bivariant) and the
 * stored content accepts the response the dialog actually sends.
 */
type ModalInstance = {
  id: number;
  content: ModalConfig<ModalResponse>["content"];
  className: string | undefined;
  dismissOnClickOff: boolean;
  dismiss(value: ModalResponse): void;
};

export type ModalProps = {
  /** Where the modal layer mounts. Defaults to `document.body`. */
  mount?: Element;
};

/**
 * App-wide modal host. Wraps a subtree and lets any descendant request a modal
 * in async code via `useRequestModal()`:
 *
 * ```tsx
 * const requestModal = useRequestModal();
 * const choice = await requestModal<"keep" | "delete">({
 *   content: ({ respond }) => (
 *     <>
 *       <h1>Are you sure?</h1>
 *       <button onClick={() => respond("keep")}>Cancel</button>
 *       <button onClick={() => respond("delete")}>Delete</button>
 *     </>
 *   ),
 * });
 * ```
 *
 * Each request renders a native `<dialog>` on the top layer, so it always sits
 * above the rest of the app without z-index juggling. `respond(value)` resolves
 * the promise and dismisses that dialog; pressing Escape responds `undefined`.
 * Pressing down on the backdrop (outside the dialog box) also responds
 * `undefined`, unless the request sets `dismissOnClickOff: false`.
 */
export function Modal(props: ParentProps<ModalProps>) {
  const [instances, setInstances] = createSignal<ModalInstance[]>([]);
  let nextId = 0;

  function requestModal<T extends ModalResponse>(config: ModalConfig<T>): Promise<T> {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => {
      resolve = res;
    });
    const instance: ModalInstance = {
      id: nextId++,
      content: config.content,
      className: config.class,
      dismissOnClickOff: config.dismissOnClickOff !== false,
      // The dialog's response is known to belong to this request's T: that is
      // what the promise's own resolver type encodes.
      dismiss: (value) => resolve(value as T),
    };
    setInstances((prev) => [...prev, instance]);
    return promise;
  }

  return (
    <ModalContext value={requestModal}>
      {props.children}
      <Portal mount={props.mount}>
        <div class={styles.root}>
          <For each={instances()}>
            {(instance) => (
              <ModalDialog
                instance={instance}
                onDismiss={(value) => {
                  instance.dismiss(value);
                  setInstances((list) => list.filter((it) => it !== instance));
                }}
              />
            )}
          </For>
        </div>
      </Portal>
    </ModalContext>
  );
}

function ModalDialog(props: {
  instance: ModalInstance;
  onDismiss: (value: ModalResponse) => void;
}) {
  const [el, setEl] = createSignal<HTMLDialogElement | undefined>(undefined);

  createEffect(
    () => el(),
    (dialog) => {
      if (dialog && dialog.isConnected && !dialog.open) dialog.showModal();
    },
  );

  // Each row of the instances For is keyed by instance identity, so
  // instance.content is stable for this dialog's life; capture once.
  // oxlint-disable-next-line solid/reactivity
  const Content = props.instance.content;
  return (
    <dialog
      ref={setEl}
      class={[panel, styles.modal, props.instance.className]}
      onCancel={(e) => {
        e.preventDefault();
        props.onDismiss(undefined);
      }}
      onPointerDown={(e) => {
        // Click-off dismissal: a press outside this dialog's box (the native
        // backdrop) responds `undefined`. Backdrop presses are dispatched to
        // the `<dialog>`, so the box is tested by coordinates — presses on the
        // dialog's own padding or scrollbar stay inside and are ignored.
        // Dismissing at pointerdown (not click) means a press that starts
        // inside the content can never count as click-off on release.
        if (e.button !== 0) return;
        if (!props.instance.dismissOnClickOff) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const inside =
          e.clientX >= rect.left &&
          e.clientX <= rect.right &&
          e.clientY >= rect.top &&
          e.clientY <= rect.bottom;
        if (!inside) props.onDismiss(undefined);
      }}
    >
      <Content respond={props.onDismiss} />
    </dialog>
  );
}
