import { Portal } from "@solidjs/web";
import { For, createEffect, createSignal } from "solid-js";
import type { ParentProps } from "solid-js";

import { ModalContext, type ModalConfig } from "./ModalContext";

import styles from "./Modal.module.css";

type ModalInstance = {
  id: number;
  config: ModalConfig<unknown>;
  resolve: (value: unknown) => void;
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
 */
export function Modal(props: ParentProps<ModalProps>) {
  const [instances, setInstances] = createSignal<ModalInstance[]>([]);
  let nextId = 0;

  function requestModal<T>(config: ModalConfig<T>): Promise<T> {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => {
      resolve = res;
    });
    const instance: ModalInstance = {
      id: nextId++,
      config: config as unknown as ModalConfig<unknown>,
      resolve: resolve as (value: unknown) => void,
    };
    setInstances((prev) => [...prev, instance]);
    return promise;
  }

  function dismiss(instance: ModalInstance, value: unknown) {
    instance.resolve(value);
    setInstances((list) => list.filter((it) => it !== instance));
  }

  return (
    <ModalContext value={requestModal}>
      {props.children}
      <Portal mount={props.mount}>
        <div class={styles.root}>
          <For each={instances()}>
            {(instance) => (
              <ModalDialog instance={instance} onDismiss={(value) => dismiss(instance, value)} />
            )}
          </For>
        </div>
      </Portal>
    </ModalContext>
  );
}

function ModalDialog(props: { instance: ModalInstance; onDismiss: (value: unknown) => void }) {
  const [el, setEl] = createSignal<HTMLDialogElement | null>(null);

  createEffect(
    () => el(),
    (dialog) => {
      if (dialog && dialog.isConnected && !dialog.open) dialog.showModal();
    },
  );

  const Content = props.instance.config.content;
  return (
    <dialog
      ref={setEl}
      class={[styles.modal, props.instance.config.class]}
      onCancel={(e) => {
        e.preventDefault();
        props.onDismiss(undefined);
      }}
    >
      <Content respond={props.onDismiss} />
    </dialog>
  );
}
