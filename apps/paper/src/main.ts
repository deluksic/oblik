import "./style.css";
import { breadcrumb, dist, projectT, type Geom } from "@design-scenes/geom";
import {
  clearWidgetOverrides,
  defaultCamera,
  drawFrame,
  gizmoValues,
  hitTest,
  resizeCanvas,
  runScene,
  screenToWorld,
  setWidgetOverride,
  zoomAt,
  type Camera,
  type Frame,
  type Gizmo,
  type SceneModule,
} from "@design-scenes/euclid2";
import * as beam from "./scenes/beam.ts";
import * as beamFlat from "./scenes/beam-flat.ts";

const SCENES: Record<string, { mod: SceneModule; title: string }> = {
  beam: { mod: beam, title: "Beam truss (grouped paths)" },
  flat: { mod: beamFlat, title: "Twin trusses (flat paths)" },
};

const sceneKey = new URLSearchParams(location.search).get("scene") ?? "beam";
const active = SCENES[sceneKey] ?? SCENES.beam!;

const canvas = document.querySelector<HTMLCanvasElement>("#paper")!;
const crumbEl = document.querySelector<HTMLElement>("#crumb")!;
const metaEl = document.querySelector<HTMLElement>("#meta")!;
const sourceEl = document.querySelector<HTMLElement>("#source")!;
const statusEl = document.querySelector<HTMLElement>("#status")!;
const errorEl = document.querySelector<HTMLElement>("#error")!;
const titleEl = document.querySelector<HTMLElement>("#scene-title")!;

titleEl.textContent = active.title;
document.title = `euclid2 — ${active.title}`;

for (const link of document.querySelectorAll<HTMLAnchorElement>(
  "#scene-nav a[data-scene]",
)) {
  link.classList.toggle("active", link.dataset.scene === sceneKey);
}

let sceneMod: SceneModule = active.mod;
let frame: Frame | null = null;
let lastGood: Frame | null = null;
let error: string | null = null;
let cam: Camera = defaultCamera();
let hoverId: string | null = null;
let selectedId: string | null = null;
let hoverGizmo: Gizmo | null = null;
let selectedGeom: Geom | null = null;
let drag: { index: number; start: number[] } | null = null;
let pan: { x: number; y: number; camX: number; camY: number } | null = null;
const peekCache = new Map<string, string>();

const SCENE_PEEK = `apps/paper/src/scenes/${active.mod.sceneFile}`;

function quantize(n: number): number {
  return Math.round(n * 100) / 100;
}

function cssSize(): { w: number; h: number } {
  const r = canvas.getBoundingClientRect();
  return { w: r.width, h: r.height };
}

function eventPos(e: PointerEvent): { x: number; y: number } {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function countEditCalls(source: string): number {
  return source
    .split("\n")
    .filter((ln) =>
      /\bedit(?:Point|DistanceToPoint|PointOnLine)\s*\(/.test(ln),
    ).length;
}

function evaluate(): void {
  try {
    frame = runScene(sceneMod);
    lastGood = frame;
    error = null;
    const source = peekCache.get(`apps/paper/src/scenes/${sceneMod.sceneFile}`);
    if (source) {
      const edits = countEditCalls(source);
      const gizmos = frame.gizmos.length;
      if (edits > 0 && gizmos !== edits) {
        error = `${gizmos} widgets at runtime but ${edits} edit* calls in scene — unroll helpers`;
      }
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    frame = lastGood;
  }
}

function activeGizmo(): number | null {
  return drag?.index ?? hoverGizmo?.index ?? null;
}

function render(): void {
  resizeCanvas(canvas);
  const { w, h } = cssSize();
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  drawFrame(
    ctx,
    w,
    h,
    cam,
    frame?.drawables ?? [],
    frame?.gizmos ?? [],
    hoverId,
    selectedId,
    activeGizmo(),
  );
  statusEl.textContent = error
    ? "Last good frame · scene threw"
    : sceneKey === "flat"
      ? "Flat paths: ticks share mark/beam.ts — each geom has a unique id"
      : "Grouped paths: group[0] › line[2] · drag handles · wheel zooms";
  errorEl.hidden = !error;
  errorEl.textContent = error ?? "";
  void updateInspect();
}

function currentTarget(): {
  title: string;
  id?: string;
  file?: string;
  line?: number;
  column?: number;
} | null {
  if (hoverGizmo) {
    return {
      title: `widget ${hoverGizmo.kind} #${hoverGizmo.index} · writes ${sceneMod.sceneFile}`,
    };
  }
  const g =
    frame?.drawables.find((d) => d.geom.id === (hoverId ?? selectedId))?.geom ??
    selectedGeom;
  if (!g) return null;
  return {
    title: breadcrumb(g.path),
    id: g.id,
    file: g.provenance.file,
    line: g.provenance.line,
    column: g.provenance.column,
  };
}

async function updateInspect(): Promise<void> {
  const t = currentTarget();
  if (!t) {
    crumbEl.textContent = "Nothing selected";
    metaEl.textContent =
      sceneKey === "flat"
        ? "Click ticks on each truss — paths differ; creation site is the library loop."
        : "Hover a tick, the roof, or the span. Handles (coral) are scene widgets.";
    sourceEl.innerHTML = `<code class="empty">Select geometry to see the creation site.</code>`;
    return;
  }
  crumbEl.textContent = t.title;
  if (t.file == null || t.line == null) {
    metaEl.textContent =
      "Coral handles are scene widgets. Numbers live in the scene file and are written on pointer-up.";
    sourceEl.innerHTML = `<code class="empty">Widget values are the numeric arguments of edit* in ${sceneMod.sceneFile}.</code>`;
    return;
  }
  metaEl.textContent = t.id
    ? `${t.id} · ${t.file}:${t.line}:${t.column ?? 0}`
    : `${t.file}:${t.line}:${t.column ?? 0}`;
  try {
    const text = await peekFile(t.file);
    sourceEl.innerHTML = renderSnippet(text, t.line);
  } catch (err) {
    sourceEl.innerHTML = `<code class="empty">${err instanceof Error ? err.message : String(err)}</code>`;
  }
}

async function peekFile(file: string): Promise<string> {
  const key = file.replace(/^\/+/, "").replace(/\?.*$/, "");
  const cached = peekCache.get(key);
  if (cached != null) return cached;
  const res = await fetch(`/__peek?file=${encodeURIComponent(key)}`);
  if (!res.ok) throw new Error(`Could not read ${key}`);
  const text = await res.text();
  peekCache.set(key, text);
  return text;
}

function renderSnippet(text: string, line: number): string {
  const lines = text.split("\n");
  const i = line - 1;
  const from = Math.max(0, i - 5);
  const to = Math.min(lines.length, i + 6);
  const chunks: string[] = [];
  for (let n = from; n < to; n++) {
    const current = n === i;
    const num = String(n + 1).padStart(4, " ");
    const body = escapeHtml(lines[n] ?? "");
    chunks.push(
      `<div class="${current ? "hl" : ""}"><span class="ln">${num}</span><span class="tx">${body}</span></div>`,
    );
  }
  return chunks.join("");
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function hit(e: PointerEvent) {
  const { w, h } = cssSize();
  const p = eventPos(e);
  return hitTest(p, cam, w, h, frame?.gizmos ?? [], frame?.drawables ?? []);
}

function applyDrag(g: Gizmo, world: { x: number; y: number }): void {
  if (g.kind === "point") {
    setWidgetOverride(g.index, [quantize(world.x), quantize(world.y)]);
  } else if (g.kind === "distance") {
    setWidgetOverride(g.index, [
      quantize(Math.max(0.05, dist(world, g.origin))),
    ]);
  } else {
    const t = Math.min(1, Math.max(0, projectT(g.a, g.b, world)));
    setWidgetOverride(g.index, [quantize(t)]);
  }
}

async function commitDrag(g: Gizmo): Promise<void> {
  const values = gizmoValues(g);
  try {
    const res = await fetch("/__write-widget", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        file: sceneMod.sceneFile,
        widgetIndex: g.index,
        values,
      }),
    });
    const body = (await res.json()) as { ok?: boolean; error?: string };
    if (!res.ok || !body.ok) {
      error = body.error ?? `write failed (${res.status})`;
    } else {
      peekCache.delete(`apps/paper/src/scenes/${sceneMod.sceneFile}`);
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
}

canvas.addEventListener("pointerdown", (e) => {
  canvas.focus();
  const p = eventPos(e);
  const h = hit(e);
  if (e.button === 1 || e.altKey) {
    pan = { x: p.x, y: p.y, camX: cam.x, camY: cam.y };
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
    return;
  }
  if (e.button !== 0) return;
  if (h?.target === "gizmo") {
    drag = { index: h.gizmo.index, start: gizmoValues(h.gizmo) };
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
    render();
    return;
  }
  if (h?.target === "geom") {
    selectedId = h.drawable.geom.id;
    selectedGeom = h.drawable.geom;
    peekCache.delete(h.drawable.geom.provenance.file);
    render();
    return;
  }
  selectedId = null;
  selectedGeom = null;
  pan = { x: p.x, y: p.y, camX: cam.x, camY: cam.y };
  canvas.setPointerCapture(e.pointerId);
  render();
});

canvas.addEventListener("pointermove", (e) => {
  const { w, h: height } = cssSize();
  const p = eventPos(e);
  if (pan) {
    cam = {
      ...cam,
      x: pan.camX - (p.x - pan.x) / cam.scale,
      y: pan.camY + (p.y - pan.y) / cam.scale,
    };
    render();
    return;
  }
  if (drag && frame) {
    const g = frame.gizmos.find((x) => x.index === drag?.index);
    if (g) {
      applyDrag(g, screenToWorld(cam, p, w, height));
      evaluate();
      render();
    }
    return;
  }
  const hitResult = hit(e);
  const nextId =
    hitResult?.target === "geom" ? hitResult.drawable.geom.id : null;
  const nextG = hitResult?.target === "gizmo" ? hitResult.gizmo : null;
  if (nextId !== hoverId || nextG?.index !== hoverGizmo?.index) {
    hoverId = nextId;
    hoverGizmo = nextG;
    render();
  }
});

canvas.addEventListener("pointerup", async () => {
  if (pan) {
    pan = null;
    return;
  }
  if (!drag || !frame) return;
  const dragging = drag;
  const g = frame.gizmos.find((x) => x.index === dragging.index);
  drag = null;
  if (!g) {
    render();
    return;
  }
  const now = gizmoValues(g);
  const changed = now.some((v, i) => v !== dragging.start[i]);
  if (changed) await commitDrag(g);
  render();
});

canvas.addEventListener("pointercancel", () => {
  pan = null;
  drag = null;
  render();
});

canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    const { w, h } = cssSize();
    cam = zoomAt(cam, { x: e.offsetX, y: e.offsetY }, w, h, e.deltaY < 0 ? 1.08 : 1 / 1.08);
    render();
  },
  { passive: false },
);

window.addEventListener("resize", () => render());

function reloadScene(mod: SceneModule): void {
  sceneMod = mod;
  clearWidgetOverrides();
  peekCache.clear();
  void peekFile(`apps/paper/src/scenes/${sceneMod.sceneFile}`).then(() => {
    evaluate();
    render();
  });
}

if (import.meta.hot) {
  import.meta.hot.accept("./scenes/beam.ts", (mod) => {
    if (!mod || !("scene" in mod) || sceneKey !== "beam") return;
    reloadScene(mod as unknown as SceneModule);
  });
  import.meta.hot.accept("./scenes/beam-flat.ts", (mod) => {
    if (!mod || !("scene" in mod) || sceneKey !== "flat") return;
    reloadScene(mod as unknown as SceneModule);
  });
}

void peekFile(SCENE_PEEK).then(() => {
  evaluate();
  render();
});
