import type { Scene } from "oblik";

export const sceneLoaders = import.meta.glob("./scenes/*.ts") as Record<
  string,
  () => Promise<{ default: Scene }>
>;
