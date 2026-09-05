import type { DuplicateId, OblikSceneEntry } from "oblik";
import { mountOblik } from "oblik/host";
import {
  annotationCollisions as initialCollisions,
  annotationsByPath as initialAnnotations,
  mentionsByPath as initialMentions,
} from "virtual:oblik-annotations";
import { scenes as initialScenes } from "virtual:oblik-catalog";

import { sceneLoaders as initialLoaders } from "./scene-loaders";

const host = mountOblik({
  el: document.getElementById("app")!,
  scenes: initialScenes,
  loaders: initialLoaders,
  annotations: initialAnnotations,
  mentions: initialMentions,
  collisions: initialCollisions,
});

const reloadLoaders = async () => (await import("./scene-loaders")).sceneLoaders;
const reloadAnnotations = async () => import("virtual:oblik-annotations");

if (import.meta.hot) {
  import.meta.hot.accept(
    ["virtual:oblik-catalog", "virtual:oblik-annotations", "./scene-loaders"],
    async (mods) => {
      const catalogMod = mods?.[0] as { scenes: OblikSceneEntry[] } | undefined;
      const annMod = mods?.[1] as
        | {
            annotationsByPath: typeof initialAnnotations;
            annotationCollisions: DuplicateId[];
            mentionsByPath: typeof initialMentions;
          }
        | undefined;
      const loadersMod = mods?.[2] as { sceneLoaders: typeof initialLoaders } | undefined;
      if (catalogMod) host.setScenes(catalogMod.scenes);
      else host.setScenes((await import("virtual:oblik-catalog")).scenes);
      if (annMod) {
        host.setAnnotations(annMod.annotationsByPath);
        host.setCollisions(annMod.annotationCollisions);
        host.setMentions(annMod.mentionsByPath);
      } else {
        const fresh = await reloadAnnotations();
        host.setAnnotations(fresh.annotationsByPath);
        host.setCollisions(fresh.annotationCollisions);
        host.setMentions(fresh.mentionsByPath);
      }
      if (loadersMod) host.setLoaders(loadersMod.sceneLoaders);
      else host.setLoaders(await reloadLoaders());
    },
  );
}
