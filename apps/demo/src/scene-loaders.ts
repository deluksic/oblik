import type { Scene } from "oblik";

/** Replaced at build time by the oblik Vite plugin from files in ./scenes/. */
export const sceneLoaders = import.meta.glob("./scenes/*.ts") as Record<
  string,
  () => Promise<{ default: Scene }>
>;
