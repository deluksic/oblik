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

function fail3d(err: unknown): void {
  errorEl.hidden = false;
  errorEl.textContent = err instanceof Error ? err.message : String(err);
  statusEl.textContent = "3D view failed to load";
}

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
      const mill = m.startPaper3d(inspect, { split: true, sceneKey: "mill" });
      refreshMill = mill.refresh;
      mill.refresh({ quiet: true });
    })
    .catch(fail3d);
} else if (sceneKey === "gearsplit") {
  document.body.classList.add("view-split");
  paper.hidden = false;
  space.hidden = false;
  titleEl.textContent = "Gears + helix";
  document.title = "euclid — Gears + helix";
  statusEl.textContent = "Loading 3D view…";
  let refreshHelix: ((opts?: { quiet?: boolean }) => void) | undefined;
  startPaper2d({
    sceneKey: "gear",
    split: true,
    onLiveChange: () => refreshHelix?.({ quiet: true }),
  });
  void import("./paper3d.ts")
    .then((m) => {
      const view = m.startPaper3d(inspect, { split: true, sceneKey: "helix" });
      refreshHelix = view.refresh;
      view.refresh({ quiet: true });
    })
    .catch(fail3d);
} else if (sceneKey === "mill") {
  document.body.classList.add("view-3d");
  paper.hidden = true;
  space.hidden = false;
  titleEl.textContent = "Milled block (3D)";
  document.title = "euclid3 — Milled block";
  statusEl.textContent = "Loading 3D view…";
  void import("./paper3d.ts")
    .then((m) => {
      m.startPaper3d(inspect, { sceneKey: "mill" });
    })
    .catch(fail3d);
} else if (sceneKey === "helix") {
  document.body.classList.add("view-3d");
  paper.hidden = true;
  space.hidden = false;
  titleEl.textContent = "Helical gears";
  document.title = "euclid3 — Helical gears";
  statusEl.textContent = "Loading 3D view…";
  void import("./paper3d.ts")
    .then((m) => {
      m.startPaper3d(inspect, { sceneKey: "helix" });
    })
    .catch(fail3d);
} else if (sceneKey === "ringsplit") {
  document.body.classList.add("view-split");
  paper.hidden = false;
  space.hidden = false;
  titleEl.textContent = "Signet · unrolled + wrap";
  document.title = "euclid — Signet band";
  statusEl.textContent = "Loading 3D view…";
  let refreshRing: ((opts?: { quiet?: boolean }) => void) | undefined;
  startPaper2d({
    sceneKey: "ring",
    split: true,
    onLiveChange: () => refreshRing?.({ quiet: true }),
  });
  void import("./paper3d.ts")
    .then((m) => {
      const view = m.startPaper3d(inspect, { split: true, sceneKey: "ring3" });
      refreshRing = view.refresh;
      view.refresh({ quiet: true });
    })
    .catch(fail3d);
} else if (sceneKey === "ring3") {
  document.body.classList.add("view-3d");
  paper.hidden = true;
  space.hidden = false;
  titleEl.textContent = "Signet wrap";
  document.title = "euclid3 — Signet wrap";
  statusEl.textContent = "Loading 3D view…";
  void import("./paper3d.ts")
    .then((m) => {
      m.startPaper3d(inspect, { sceneKey: "ring3" });
    })
    .catch(fail3d);
} else {
  document.body.classList.add("view-2d");
  paper.hidden = false;
  space.hidden = true;
  startPaper2d();
}
