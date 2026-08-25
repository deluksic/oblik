import { mountOblik } from "oblik/host";
import type { OblikSceneEntry } from "oblik";
import { scenes as initialScenes } from "virtual:oblik-catalog";

import { sceneLoaders as initialLoaders } from "./scene-loaders";

const host = mountOblik({
  el: document.getElementById("app")!,
  scenes: initialScenes,
  loaders: initialLoaders,
});

if (import.meta.hot) {
  import.meta.hot.accept(["virtual:oblik-catalog", "./scene-loaders"], async (mods) => {
    const catalogMod = mods?.[0] as { scenes: OblikSceneEntry[] } | undefined;
    const loadersMod = mods?.[1] as { sceneLoaders: typeof initialLoaders } | undefined;
    if (catalogMod) host.setScenes(catalogMod.scenes);
    else {
      const fresh = await import("virtual:oblik-catalog");
      host.setScenes(fresh.scenes);
    }
    if (loadersMod) host.setLoaders(loadersMod.sceneLoaders);
    else host.setLoaders((await import("./scene-loaders")).sceneLoaders);
    await host.reloadCurrentScene();
  });
}
