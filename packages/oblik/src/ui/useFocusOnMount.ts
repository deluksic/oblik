import { createEffect, createSignal } from "solid-js";

/**
 * Ref callback that focuses the element once it is mounted.
 *
 * `autofocus`/`autoFocus` cannot do this for dynamically mounted elements: the
 * browser only honors `autofocus` during the initial document parse, and Solid
 * invokes plain ref callbacks before the node is connected to the DOM, so
 * `ref={(el) => el.focus()}` is a silent no-op. This hook pairs a signal ref
 * with an effect whose body runs after insertion, so the element is focused on
 * every mount of the owning component (not just the first page load).
 *
 * ```tsx
 * const focusSearch = useFocusOnMount();
 * <input ref={focusSearch} />;
 * ```
 */
export function useFocusOnMount(): (el: HTMLElement | undefined) => void {
  const [el, setEl] = createSignal<HTMLElement | undefined>(undefined);
  createEffect(
    () => el(),
    (node) => {
      if (!node) return;
      node.focus();
    },
  );
  return setEl;
}
