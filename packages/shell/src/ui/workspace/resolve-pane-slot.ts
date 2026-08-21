import type { SceneEntry, SceneLoaderMap, ViewHost, ViewKind } from "@/types";
import type { PaneMount } from "@/ui/Pane";

import { loaderKey } from "./model";

export class PaneResolveError extends Error {
  readonly id: string;
  readonly label: string;

  constructor(id: string, label: string, message: string) {
    super(message);
    this.name = "PaneResolveError";
    this.id = id;
    this.label = label;
  }
}

export function paneResolveFallback(
  err: unknown,
  id: string,
): { id: string; label: string; message: string } {
  if (err instanceof PaneResolveError) {
    return { id: err.id, label: err.label, message: err.message };
  }
  return {
    id,
    label: id,
    message: err instanceof Error ? err.message : String(err),
  };
}

export function resolvePaneSlot(
  id: string,
  paneEntry: SceneEntry | undefined,
  mount: PaneMount | undefined,
  hosts: Partial<Record<ViewKind, ViewHost>>,
  loaders: SceneLoaderMap,
): PaneMount {
  if (!paneEntry) {
    throw new PaneResolveError(id, id, `Unknown scene id "${id}" in layout.`);
  }
  if (paneEntry.error) {
    throw new PaneResolveError(id, id, paneEntry.error);
  }
  if (!paneEntry.hasScene) {
    throw new PaneResolveError(id, id, `${paneEntry.file} is a layout, not a view.`);
  }
  if (mount) return mount;
  const host = hosts[paneEntry.view];
  const loader = loaders[loaderKey(paneEntry.file)];
  const message = !host
    ? `No view host registered for "${paneEntry.view}".`
    : !loader
      ? `No loader for ${paneEntry.file}.`
      : "Failed to mount pane.";
  throw new PaneResolveError(id, id, message);
}

export function sceneViewportError(sceneId: string, entry: SceneEntry | undefined): string {
  if (!entry) return `No scene file for "${sceneId}".`;
  return entry.error ?? "Scene error";
}
