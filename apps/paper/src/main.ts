import { defaultHosts } from "@design-scenes/hosts";
import { startWorkspace } from "@design-scenes/shell";
import { scenes } from "virtual:scene-catalog";

import { sceneLoaders } from "./scene-loaders.ts";

const app = document.querySelector<HTMLElement>("#app");
if (!app) throw new Error("#app mount node missing");

startWorkspace(app, {
  scenes,
  loaders: sceneLoaders,
  hosts: defaultHosts,
});

if (import.meta.hot) {
  import.meta.hot.accept(["virtual:scene-catalog", "./scene-loaders.ts"], () => {});
}
