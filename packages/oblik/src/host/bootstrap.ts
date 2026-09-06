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
    // One accept per dep: the callback only ever sees the freshly fetched
    // module. A combined multi-dep accept would fire on every update and
    // re-import unchanged deps, which hits the browser's module cache and
    // resurrects stale catalog/annotation state.
    import.meta.hot.accept("virtual:oblik-catalog", (mod) => {
      if (mod) host.setScenes((mod as unknown as { scenes: OblikSceneEntry[] }).scenes);
    });
    import.meta.hot.accept("virtual:oblik-annotations", (mod) => {
      if (!mod) return;
      const fresh = mod as unknown as {
        annotationsByPath: AnnotationBundle;
        annotationCollisions: DuplicateId[];
        mentionsByPath: MentionBundle;
      };
      host.setAnnotations(fresh.annotationsByPath);
      host.setCollisions(fresh.annotationCollisions);
      host.setMentions(fresh.mentionsByPath);
    });
    import.meta.hot.accept("virtual:oblik-loaders", (mod) => {
      if (mod) host.setLoaders((mod as unknown as { sceneLoaders: SceneLoaderMap }).sceneLoaders);
    });
  }
}
