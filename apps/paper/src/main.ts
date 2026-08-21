import { defaultHosts } from "@design-scenes/hosts";
import { startWorkspace } from "@design-scenes/shell";
import { scenes } from "virtual:scene-catalog";

import { sceneLoaders } from "./scene-loaders.ts";

const crumbEl = document.querySelector<HTMLElement>("#crumb")!;
const metaEl = document.querySelector<HTMLElement>("#meta")!;
const sourceEl = document.querySelector<HTMLElement>("#source")!;
const statusEl = document.querySelector<HTMLElement>("#status")!;
const errorEl = document.querySelector<HTMLElement>("#error")!;
const titleEl = document.querySelector<HTMLElement>("#scene-title")!;
const navRoot = document.querySelector<HTMLElement>("#scene-nav")!;
const viewportRoot = document.querySelector<HTMLElement>("#viewport")!;

void startWorkspace({
  scenes,
  loaders: sceneLoaders,
  hosts: defaultHosts,
  navRoot,
  viewportRoot,
  inspect: { crumbEl, metaEl, sourceEl, statusEl, errorEl },
  titleEl,
});

if (import.meta.hot) {
  import.meta.hot.accept(["virtual:scene-catalog", "./scene-loaders.ts"], () => {});
}
