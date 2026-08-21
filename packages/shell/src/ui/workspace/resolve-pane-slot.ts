import type { SceneEntry, SceneLoaderMap, ViewHost, ViewKind } from "@/types";
import type { PaneMount } from "@/ui/Pane";

import { loaderKey } from "./model";

export type PaneSlot =
  | { kind: "live"; mount: PaneMount }
  | { kind: "error"; id: string; label: string; message: string };

export function resolvePaneSlot(
  id: string,
  paneEntry: SceneEntry | undefined,
  mount: PaneMount | undefined,
  hosts: Partial<Record<ViewKind, ViewHost>>,
  loaders: SceneLoaderMap,
): PaneSlot {
  if (!paneEntry) {
    return {
      kind: "error",
      id,
      label: id,
      message: `Unknown scene id "${id}" in layout.`,
    };
  }
  if (paneEntry.error) {
    return { kind: "error", id, label: id, message: paneEntry.error };
  }
  if (!paneEntry.hasScene) {
    return {
      kind: "error",
      id,
      label: id,
      message: `${paneEntry.file} is a layout, not a view.`,
    };
  }
  if (mount) return { kind: "live", mount };
  const host = hosts[paneEntry.view];
  const loader = loaders[loaderKey(paneEntry.file)];
  const message = !host
    ? `No view host registered for "${paneEntry.view}".`
    : !loader
      ? `No loader for ${paneEntry.file}.`
      : "Failed to mount pane.";
  return { kind: "error", id, label: id, message };
}

export function sceneViewportError(sceneId: string, entry: SceneEntry | undefined): string {
  if (!entry) return `No scene file for "${sceneId}".`;
  return entry.error ?? "Scene error";
}
