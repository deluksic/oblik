import { Show } from "solid-js";

import { outsideClipD } from "./chrome";

export function ChromeOutsideClip(props: { id: string; d: string }) {
  return (
    <Show when={props.d}>
      <clipPath id={props.id} clipPathUnits="userSpaceOnUse">
        <path d={outsideClipD(props.d)} clip-rule="evenodd" />
      </clipPath>
    </Show>
  );
}
