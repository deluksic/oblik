import { Show } from "solid-js";
import IconDraftingCompass from "~icons/lucide/drafting-compass";
import IconPaintbrush from "~icons/lucide/paintbrush";

import type { OblikSceneEntry } from "../source/catalog";

export type SceneKind = OblikSceneEntry["kind"];

export type SceneKindIconProps = {
  kind: SceneKind;
  /** Sizing/tinting class (e.g. a CSS-module rule); the icon inherits its color. */
  class?: string;
};

/**
 * Scene-kind glyph for scene lists: a drafting compass for `euclid2`
 * (constructive geometry) and a paintbrush for `figure` (ink scenes).
 */
export function SceneKindIcon(props: SceneKindIconProps) {
  // Branch inside the template (Show), not by picking a component into a local
  // const — props are only readable in a reactive scope, so a body-level
  // ternary would freeze the icon choice at first render.
  return (
    <Show
      when={props.kind === "figure"}
      fallback={<IconDraftingCompass class={props.class} aria-hidden="true" />}
    >
      <IconPaintbrush class={props.class} aria-hidden="true" />
    </Show>
  );
}
