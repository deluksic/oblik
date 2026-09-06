/*
 * Ambient types for the modules the oblik vite plugin serves. Referenced from
 * host/bootstrap.ts so any program that imports oblik/host picks these up —
 * consumers must not redeclare them.
 */
declare module "virtual:oblik-catalog" {
  import type { OblikSceneEntry } from "oblik";
  export const scenes: OblikSceneEntry[];
}

declare module "virtual:oblik-annotations" {
  import type { Annotation, DuplicateId } from "oblik";
  import type { MentionFile } from "oblik";
  export const annotationsByPath: Record<string, Record<string, Annotation>>;
  export const annotationCollisions: DuplicateId[];
  export const mentionsByPath: Record<string, MentionFile>;
}

declare module "virtual:oblik-annotations?*" {
  import type { Annotation } from "oblik";
  const annotations: Record<string, Annotation>;
  export default annotations;
}

declare module "virtual:oblik-loaders" {
  import type { SceneLoaderMap } from "oblik/host";
  export const sceneLoaders: SceneLoaderMap;
}
