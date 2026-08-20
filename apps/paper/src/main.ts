import "./style.css";
import "../../../packages/shell/src/workspace.css";
import { scenes } from "virtual:scene-catalog";
import { startWorkspace } from "@design-scenes/shell";
import { euclid2Host } from "./hosts/euclid2.ts";
import { euclid3Host } from "./hosts/euclid3.ts";
import { sdfHost } from "./hosts/sdf.ts";
import { sdf2Host } from "./hosts/sdf2.ts";
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
  hosts: {
    euclid2: euclid2Host,
    euclid3: euclid3Host,
    sdf: sdfHost,
    sdf2: sdf2Host,
  },
  navRoot,
  viewportRoot,
  inspect: { crumbEl, metaEl, sourceEl, statusEl, errorEl },
  titleEl,
});

if (import.meta.hot) {
  import.meta.hot.accept(
    ["virtual:scene-catalog", "./scene-loaders.ts"],
    () => {},
  );
}
