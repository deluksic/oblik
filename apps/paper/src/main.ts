import "./style.css";
import { startPaper2d } from "./paper2d.ts";

const sceneKey = new URLSearchParams(location.search).get("scene") ?? "beam";

const crumbEl = document.querySelector<HTMLElement>("#crumb")!;
const metaEl = document.querySelector<HTMLElement>("#meta")!;
const sourceEl = document.querySelector<HTMLElement>("#source")!;
const statusEl = document.querySelector<HTMLElement>("#status")!;
const errorEl = document.querySelector<HTMLElement>("#error")!;
const titleEl = document.querySelector<HTMLElement>("#scene-title")!;

for (const link of document.querySelectorAll<HTMLAnchorElement>(
  "#scene-nav a[data-scene]",
)) {
  link.classList.toggle("active", link.dataset.scene === sceneKey);
}

if (sceneKey === "mill") {
  titleEl.textContent = "Milled block (3D)";
  document.title = "euclid3 — Milled block";
  statusEl.textContent = "Loading 3D view…";
  void import("./paper3d.ts")
    .then((m) => {
      m.startPaper3d({ crumbEl, metaEl, sourceEl, statusEl, errorEl });
    })
    .catch((err) => {
      errorEl.hidden = false;
      errorEl.textContent =
        err instanceof Error ? err.message : String(err);
      statusEl.textContent = "3D view failed to load";
    });
} else {
  startPaper2d();
}
