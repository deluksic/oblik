import { createContext, useContext } from "solid-js";
import type { Component } from "solid-js";

export type ModalConfig<T> = {
  /** Optional extra class applied to the `<dialog>`. */
  class?: string;
  /**
   * Dismiss the modal (`respond(undefined)`) when the user presses down outside
   * its content — on the backdrop or the `<dialog>`'s own chrome. Defaults to
   * `true`; set `false` to require an explicit action (close button, Escape,
   * or a content button) to dismiss.
   */
  dismissOnClickOff?: boolean;
  /** Renders the modal body. Call `respond(value)` to close and resolve the promise. */
  content: Component<{ respond: (value: T) => void }>;
};

/** Identity helper so TypeScript can infer a modal's response type at the call site. */
export function defineModal<T>(modal: ModalConfig<T>): ModalConfig<T> {
  return modal;
}

export type RequestModalFn = <T = void>(config: ModalConfig<T>) => Promise<T>;

/** Default-less context: reading it outside a `<Modal>` throws `ContextNotFoundError`. */
export const ModalContext = createContext<RequestModalFn>();

/** Read the `requestModal` function provided by the nearest `<Modal>` ancestor. */
export function useRequestModal(): RequestModalFn {
  return useContext(ModalContext);
}
