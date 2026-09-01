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

export function ChromeInsideClip(props: { id: string; d: string }) {
  return (
    <Show when={props.d}>
      <clipPath id={props.id} clipPathUnits="userSpaceOnUse">
        <path d={props.d} />
      </clipPath>
    </Show>
  );
}

export function ChromeClosedClips(props: { outsideId: string; insideId: string; d: string }) {
  return (
    <>
      <ChromeOutsideClip id={props.outsideId} d={props.d} />
      <ChromeInsideClip id={props.insideId} d={props.d} />
    </>
  );
}
