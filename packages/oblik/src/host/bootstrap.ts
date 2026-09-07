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
    //
    // Each accept skips no-op updates (same content as last seen), so one
    // scene edit only invalidates downstream memos when something changed.
    let lastScenes = JSON.stringify(initialScenes);
    import.meta.hot.accept("virtual:oblik-catalog", (mod) => {
      if (!mod) return;
      const scenes = (mod as unknown as { scenes: OblikSceneEntry[] }).scenes;
      const next = JSON.stringify(scenes);
      if (next === lastScenes) return;
      lastScenes = next;
      host.setScenes(scenes);
    });
    let lastAnnotations = JSON.stringify([
      initialAnnotations,
      initialMentions,
      initialCollisions,
    ]);
    import.meta.hot.accept("virtual:oblik-annotations", (mod) => {
      if (!mod) return;
      const fresh = mod as unknown as {
        annotationsByPath: AnnotationBundle;
        annotationCollisions: DuplicateId[];
        mentionsByPath: MentionBundle;
      };
      const next = JSON.stringify([
        fresh.annotationsByPath,
        fresh.mentionsByPath,
        fresh.annotationCollisions,
      ]);
      if (next === lastAnnotations) return;
      lastAnnotations = next;
      host.setAnnotations(fresh.annotationsByPath);
      host.setCollisions(fresh.annotationCollisions);
      host.setMentions(fresh.mentionsByPath);
    });
    let lastLoaders = JSON.stringify(initialLoaders);
    import.meta.hot.accept("virtual:oblik-loaders", (mod) => {
      if (!mod) return;
      const loaders = (mod as unknown as { sceneLoaders: SceneLoaderMap }).sceneLoaders;
      const next = JSON.stringify(loaders);
      if (next === lastLoaders) return;
      lastLoaders = next;
      host.setLoaders(loaders);
    });
  }
}
