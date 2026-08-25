import { mountOblik } from "oblik/host";
import type { OblikSceneEntry } from "oblik";
import { annotationsByPath as initialAnnotations } from "virtual:oblik-annotations";
import { scenes as initialScenes } from "virtual:oblik-catalog";

import { sceneLoaders as initialLoaders } from "./scene-loaders";

const host = mountOblik({
  el: document.getElementById("app")!,
  scenes: initialScenes,
  loaders: initialLoaders,
  annotations: initialAnnotations,
});

if (import.meta.hot) {
  import.meta.hot.accept(
    ["virtual:oblik-catalog", "virtual:oblik-annotations", "./scene-loaders"],
    async (mods) => {
      const catalogMod = mods?.[0] as { scenes: OblikSceneEntry[] } | undefined;
      const annMod = mods?.[1] as { annotationsByPath: typeof initialAnnotations } | undefined;
      const loadersMod = mods?.[2] as { sceneLoaders: typeof initialLoaders } | undefined;
      if (catalogMod) host.setScenes(catalogMod.scenes);
      else {
        const fresh = await import("virtual:oblik-catalog");
        host.setScenes(fresh.scenes);
      }
      if (annMod) host.setAnnotations(annMod.annotationsByPath);
      else {
        const fresh = await import("virtual:oblik-annotations");
        host.setAnnotations(fresh.annotationsByPath);
      }
      if (loadersMod) host.setLoaders(loadersMod.sceneLoaders);
      else host.setLoaders((await import("./scene-loaders")).sceneLoaders);
      await host.reloadCurrentScene();
    },
  );
}
