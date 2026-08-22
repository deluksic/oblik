import { defaultHosts } from "@design-scenes/hosts";
import { createCatalogWorkspaceState, startWorkspace } from "@design-scenes/shell";
import type { SceneEntry, SceneLoaderMap } from "@design-scenes/shell";
import { scenes as initialScenes } from "virtual:scene-catalog";

import { sceneLoaders as initialLoaders } from "./scene-loaders";

const app = document.querySelector<HTMLElement>("#app");
if (!app) throw new Error("#app mount node missing");

const reloadLoaders = (): Promise<SceneLoaderMap> =>
  import("./scene-loaders").then((mod) => mod.sceneLoaders);

const catalog = createCatalogWorkspaceState(initialScenes, initialLoaders, reloadLoaders);

if (import.meta.hot) {
  import.meta.hot.accept(["virtual:scene-catalog", "./scene-loaders"], async (mods) => {
    const catalogMod = mods?.[0] as { scenes: SceneEntry[] } | undefined;
    const loadersMod = mods?.[1] as { sceneLoaders: SceneLoaderMap } | undefined;
    if (catalogMod) catalog.setScenes(catalogMod.scenes);
    else {
      const fresh = await import("virtual:scene-catalog");
      catalog.setScenes(fresh.scenes);
    }
    if (loadersMod) catalog.setLoaders(loadersMod.sceneLoaders);
    else catalog.setLoaders(await reloadLoaders());
  });
}

startWorkspace(app, () => catalog.getProps(defaultHosts));
