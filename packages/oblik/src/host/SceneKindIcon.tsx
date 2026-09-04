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
  const Icon = props.kind === "figure" ? IconPaintbrush : IconDraftingCompass;
  return <Icon class={props.class} aria-hidden="true" />;
}
