import "./style.css";
import { startPaper2d } from "./paper2d.ts";

const sceneKey = new URLSearchParams(location.search).get("scene") ?? "beam";

const crumbEl = document.querySelector<HTMLElement>("#crumb")!;
const metaEl = document.querySelector<HTMLElement>("#meta")!;
const sourceEl = document.querySelector<HTMLElement>("#source")!;
const statusEl = document.querySelector<HTMLElement>("#status")!;
const errorEl = document.querySelector<HTMLElement>("#error")!;
const titleEl = document.querySelector<HTMLElement>("#scene-title")!;
const paper = document.querySelector<HTMLCanvasElement>("#paper")!;
const space = document.querySelector<HTMLCanvasElement>("#space")!;

for (const link of document.querySelectorAll<HTMLAnchorElement>(
  "#scene-nav a[data-scene]",
)) {
  link.classList.toggle("active", link.dataset.scene === sceneKey);
}

const inspect = { crumbEl, metaEl, sourceEl, statusEl, errorEl };

if (sceneKey === "split") {
  document.body.classList.add("view-split");
  paper.hidden = false;
  space.hidden = false;
  titleEl.textContent = "Plate + mill";
  document.title = "euclid — Plate + mill";
  statusEl.textContent = "Loading 3D view…";
  let refreshMill: ((opts?: { quiet?: boolean }) => void) | undefined;
  startPaper2d({
    sceneKey: "plate",
    split: true,
    onLiveChange: () => refreshMill?.({ quiet: true }),
  });
  void import("./paper3d.ts")
    .then((m) => {
      const mill = m.startPaper3d(inspect, { split: true });
      refreshMill = mill.refresh;
      mill.refresh({ quiet: true });
    })
    .catch((err) => {
      errorEl.hidden = false;
      errorEl.textContent =
        err instanceof Error ? err.message : String(err);
      statusEl.textContent = "3D view failed to load";
    });
} else if (sceneKey === "mill") {
  document.body.classList.add("view-3d");
  paper.hidden = true;
  space.hidden = false;
  titleEl.textContent = "Milled block (3D)";
  document.title = "euclid3 — Milled block";
  statusEl.textContent = "Loading 3D view…";
  void import("./paper3d.ts")
    .then((m) => {
      m.startPaper3d(inspect);
    })
    .catch((err) => {
      errorEl.hidden = false;
      errorEl.textContent =
        err instanceof Error ? err.message : String(err);
      statusEl.textContent = "3D view failed to load";
    });
} else {
  document.body.classList.add("view-2d");
  paper.hidden = false;
  space.hidden = true;
  startPaper2d();
}
