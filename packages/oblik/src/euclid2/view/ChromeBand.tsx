import { For, Show, type Accessor, type Element } from "solid-js";

import type { ChromeSplit } from "./marks";

// Paint, then overlay. Keyed so eval identity churn does not remount SVG.
// NOTE: <For keyed={fn}> passes each item as an *accessor* (Solid 2), and the
// render-prop children reads it in its own template — so forwarding the row
// accessor below is intended; the reactivity rule cannot see into children.
export function ChromeBand<T>(props: {
  band: ChromeSplit<T>;
  halos?: boolean;
  keyed: (item: T) => string | number;
  children: (item: Accessor<T>, overlay: boolean) => Element;
}) {
  const halos = () => props.halos !== false;
  return (
    <>
      <For each={props.band.rest} keyed={props.keyed}>
        {/* oxlint-disable-next-line solid/reactivity */}
        {(n) => props.children(n, false)}
      </For>
      <Show when={halos()}>
        <For each={props.band.hover} keyed={props.keyed}>
          {/* oxlint-disable-next-line solid/reactivity */}
          {(n) => props.children(n, true)}
        </For>
      </Show>
      <For each={props.band.hover} keyed={props.keyed}>
        {/* oxlint-disable-next-line solid/reactivity */}
        {(n) => props.children(n, false)}
      </For>
      <Show when={halos()}>
        <For each={props.band.lifted} keyed={props.keyed}>
          {/* oxlint-disable-next-line solid/reactivity */}
          {(n) => props.children(n, true)}
        </For>
      </Show>
      <For each={props.band.lifted} keyed={props.keyed}>
        {/* oxlint-disable-next-line solid/reactivity */}
        {(n) => props.children(n, false)}
      </For>
    </>
  );
}
