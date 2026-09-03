import { For, Show, type Element } from "solid-js";

import type { ChromeSplit } from "./marks";

/** Paint, then overlay, without For-keying on ephemeral pass objects. */
export function ChromeBand<T>(props: {
  band: ChromeSplit<T>;
  halos?: boolean;
  children: (item: T, overlay: boolean) => Element;
}) {
  const halos = () => props.halos !== false;
  return (
    <>
      <For each={props.band.rest}>{(n) => props.children(n, false)}</For>
      <Show when={halos()}>
        <For each={props.band.hover}>{(n) => props.children(n, true)}</For>
      </Show>
      <For each={props.band.hover}>{(n) => props.children(n, false)}</For>
      <Show when={halos()}>
        <For each={props.band.lifted}>{(n) => props.children(n, true)}</For>
      </Show>
      <For each={props.band.lifted}>{(n) => props.children(n, false)}</For>
    </>
  );
}
