import type { SceneLoaderMap } from "@design-scenes/shell";

export const sceneLoaders = import.meta.glob("./scenes/*.scene.ts") as SceneLoaderMap;
