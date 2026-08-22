import { createSignal } from "solid-js";

import type { SceneEntry, SceneLoaderMap, ViewHost, ViewKind, WorkspaceProps } from "./types";
import { mergeSceneEntry } from "./ui/workspace/model";

export type CatalogWorkspaceState = {
  getProps: (hosts: Partial<Record<ViewKind, ViewHost>>) => WorkspaceProps;
  setScenes: (scenes: SceneEntry[]) => void;
  setLoaders: (loaders: SceneLoaderMap) => void;
};

export function createCatalogWorkspaceState(
  initialScenes: SceneEntry[],
  initialLoaders: SceneLoaderMap,
  reloadLoaders: () => Promise<SceneLoaderMap>,
): CatalogWorkspaceState {
  const [scenes, setScenes] = createSignal(initialScenes);
  const [loaders, setLoaders] = createSignal(initialLoaders);

  async function onSceneCreated(entry: SceneEntry): Promise<void> {
    setScenes((list) => mergeSceneEntry(list, entry));
    setLoaders(await reloadLoaders());
  }

  return {
    getProps: (hosts) => ({
      scenes: scenes(),
      loaders: loaders(),
      hosts,
      onSceneCreated,
    }),
    setScenes,
    setLoaders,
  };
}
