// oxlint-disable-next-line typescript/triple-slash-reference -- pulls the ambient virtual-module types into consumer programs
/// <reference path="../virtual.d.ts" />

import {
  annotationCollisions as initialCollisions,
  annotationsByPath as initialAnnotations,
  mentionsByPath as initialMentions,
} from "virtual:oblik-annotations";
import { scenes as initialScenes } from "virtual:oblik-catalog";
import { sceneLoaders as initialLoaders } from "virtual:oblik-loaders";

import type { DuplicateId, OblikSceneEntry } from "../source/catalog";
import type { AnnotationBundle, MentionBundle, SceneLoaderMap } from "./Host";
import { mountOblik } from "./Host";

export type BootstrapOpts = {
  el?: HTMLElement;
};

/** Zero-config entry point: mounts the host on the initial catalog and keeps it fresh over HMR. */
export function bootstrap(opts: BootstrapOpts = {}): void {
  const host = mountOblik({
    el: opts.el ?? document.getElementById("app")!,
    scenes: initialScenes,
    loaders: initialLoaders,
    annotations: initialAnnotations,
    mentions: initialMentions,
    collisions: initialCollisions,
  });

  if (import.meta.hot) {
    import.meta.hot.accept(
      ["virtual:oblik-catalog", "virtual:oblik-annotations", "virtual:oblik-loaders"],
      async (mods) => {
        const catalogMod = mods?.[0] as { scenes: OblikSceneEntry[] } | undefined;
        const annMod = mods?.[1] as
          | {
              annotationsByPath: AnnotationBundle;
              annotationCollisions: DuplicateId[];
              mentionsByPath: MentionBundle;
            }
          | undefined;
        const loadersMod = mods?.[2] as { sceneLoaders: SceneLoaderMap } | undefined;
        if (catalogMod) host.setScenes(catalogMod.scenes);
        else host.setScenes((await import("virtual:oblik-catalog")).scenes);
        if (annMod) {
          host.setAnnotations(annMod.annotationsByPath);
          host.setCollisions(annMod.annotationCollisions);
          host.setMentions(annMod.mentionsByPath);
        } else {
          const fresh = await import("virtual:oblik-annotations");
          host.setAnnotations(fresh.annotationsByPath);
          host.setCollisions(fresh.annotationCollisions);
          host.setMentions(fresh.mentionsByPath);
        }
        if (loadersMod) host.setLoaders(loadersMod.sceneLoaders);
        else host.setLoaders((await import("virtual:oblik-loaders")).sceneLoaders);
      },
    );
  }
}
