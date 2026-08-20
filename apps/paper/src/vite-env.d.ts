/// <reference types="vite/client" />

declare module "virtual:scene-catalog" {
  import type { SceneEntry } from "@design-scenes/shell";
  export const scenes: SceneEntry[];
}
