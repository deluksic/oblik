import { breadcrumb, dist, projectT, type Geom } from "@design-scenes/geom";
import {
  publishWidgetOverrides,
  clearWidgetOverrides,
  defaultCamera,
  drawFrame,
  numberValueFromPointer,
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
import * as beamShared from "./scenes/beam-shared.ts";
import * as plate from "./scenes/plate.ts";
import * as nest from "./scenes/nest.ts";
import * as relative from "./scenes/relative.ts";
import * as gear from "./scenes/gear.ts";
import * as ring from "./scenes/ring.ts";
import * as cylinder from "./scenes/cylinder.ts";

export type StartPaper2dOpts = {
  sceneKey?: string;
  split?: boolean;
  onLiveChange?: () => void;
};

export function startPaper2d(opts: StartPaper2dOpts = {}): void {
const SCENES: Record<string, { mod: SceneModule; title: string }> = {
  beam: { mod: beam, title: "Beam truss (grouped paths)" },
  flat: { mod: beamFlat, title: "Twin trusses (flat paths)" },
  shared: { mod: beamShared, title: "Shared radius (one literal)" },
  plate: { mod: plate, title: "Milled plate" },
  nest: { mod: nest, title: "Print nest (grid of plates)" },
  relative: { mod: relative, title: "Relative handle (write-back stress)" },
  gear: { mod: gear, title: "Involute gears" },
  ring: { mod: ring, title: "Signet band (unrolled)" },
  cylinder: { mod: cylinder, title: "Cylinder top (plan)" },
};

const urlScene = new URLSearchParams(location.search).get("scene") ?? "beam";
const sceneKey = opts.sceneKey ?? urlScene;
const active = SCENES[sceneKey] ?? SCENES.beam!;

const canvas = document.querySelector<HTMLCanvasElement>("#paper")!;
const paperLabel = document.querySelector("#pane-paper .view-label");
if (paperLabel) paperLabel.textContent = `2D · ${active.mod.sceneFile}`;
const crumbEl = document.querySelector<HTMLElement>("#crumb")!;
const metaEl = document.querySelector<HTMLElement>("#meta")!;
const sourceEl = document.querySelector<HTMLElement>("#source")!;
const statusEl = document.querySelector<HTMLElement>("#status")!;
const errorEl = document.querySelector<HTMLElement>("#error")!;
const titleEl = document.querySelector<HTMLElement>("#scene-title")!;

if (!opts.split) {
  titleEl.textContent = active.title;
  document.title = `euclid2 — ${active.title}`;

  for (const link of document.querySelectorAll<HTMLAnchorElement>(
    "#scene-nav a[data-scene]",
  )) {
    link.classList.toggle("active", link.dataset.scene === sceneKey);
  }
}

let sceneMod: SceneModule = active.mod;
let frame: Frame | null = null;
let lastGood: Frame | null = null;
let error: string | null = null;
let cam: Camera =
  sceneKey === "nest"
    ? { x: 0, y: 0, scale: 18 }
    : sceneKey === "gear"
      ? { x: 0.4, y: 0.15, scale: 28 }
      : sceneKey === "ring"
        ? { x: 18, y: 3.2, scale: 14 }
        : sceneKey === "cylinder"
          ? { x: 0, y: 0, scale: 16 }
        : defaultCamera();
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
      /\bedit(?:Number|Angle|Point|DistanceToPoint|PointOnLine)\s*\(/.test(ln),
    ).length;
}

function evaluate(): void {
  try {
    frame = runScene(sceneMod, sceneKey);
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
  if (
    selectedId &&
    !(frame?.drawables.some((d) => d.geom.id === selectedId) ?? false)
  ) {
    selectedId = null;
    selectedGeom = null;
  }
  publishWidgetOverrides(sceneKey);
  opts.onLiveChange?.();
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
    : opts.split
      ? sceneKey === "gear"
        ? "Drag 2D handles — helix follows live · coral mesh angle on the pinion · Helix ° slider · 3D glider is face width"
        : sceneKey === "ring"
          ? "Drag the bore, shank, and signet on the unrolled strip — the wrap has no 3D widgets"
          : sceneKey === "cylinder"
            ? "Drag the centre-cell quatrefoil — all seven follow · middle pane is the sweep profile · coral glider on the right is height"
          : "Drag 2D handles — mill follows live · Hole count is the titled slider · coral glider on the right is thickness"
      : sceneKey === "flat"
      ? "Flat paths: ticks share demo/beam.ts — each geom has a unique id"
      : sceneKey === "shared"
        ? "One dashed radius — all three rings and the roof follow it while you drag"
        : sceneKey === "plate"
          ? "Plate: corner bolts, polar array, titled hole-count slider, pocket, slot · wheel zooms"
          : sceneKey === "nest"
            ? "Same plate, instanced. Columns step hole count. Sliders: columns, rows, gap"
          : sceneKey === "relative"
            ? "Drag the left point: it writes. Drag the right: preview works, write-back cannot patch expressions"
            : sceneKey === "gear"
              ? "Involute pair. Drag the pinion, pitch radius, and coral mesh angle on the pitch circle. Helix ° feeds the 3D scene"
            : sceneKey === "ring"
              ? "Unrolled signet. Dashed circle is inner R (strip length 2πR). Shank and signet heights sit on the developed paper; Gauge is thickness"
              : sceneKey === "cylinder"
                ? "Seven cylinders, hex-packed (fixed). Drag the centre cell: quatrefoil ring, centre Ø, foil Ø"
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
      opts.split
        ? sceneKey === "gear"
          ? "2D writes gear.ts; 3D face width writes helix.ts. The helix follows these handles while you drag."
          : sceneKey === "ring"
            ? "2D writes ring.ts. The wrap is a view — ring3.ts has no edit* calls."
            : sceneKey === "cylinder"
              ? "2D writes cylinder.ts (quatrefoil ring + both ball Ø). The hex pack of seven is fixed. Height writes rose-sdf.ts."
            : "2D writes plate.ts; 3D thickness writes mill.ts. Mill XY follows these handles while you drag."
        : sceneKey === "flat"
        ? "Click ticks on each truss — paths differ; creation site is the library loop."
        : sceneKey === "shared"
          ? "One coral radius around the middle post. Library circles on the other posts are not handles."
          : sceneKey === "plate"
            ? "Drag corner bolts, the polar array, the Hole count slider, pocket, or slot."
            : sceneKey === "nest"
              ? "Each cell is drawPlate(plateLayout()). Hole count increases left → right. Pick any copy — ids differ, provenance is the same library line."
              : sceneKey === "relative"
              ? "Right handle is editPoint(a.x + …, a.y + …). Source is the truth only when args are numeric literals."
              : sceneKey === "gear"
                ? "Click a flank, tip arc, or the mesh-angle handle on the pinion. Helix ° is a titled slider for the 3D extrude."
              : sceneKey === "ring"
                ? "Plan circle is the bore. The long strip is the developed band; signet height is the dashed circle at mid-strip."
                : sceneKey === "cylinder"
                  ? "Seven equal circles, six around one (not a handle). Dashed gizmos on the centre cell: quatrefoil ring, centre Ø, foil Ø."
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

function applyDrag(
  g: Gizmo,
  world: { x: number; y: number },
  screen: { x: number; y: number },
  cssW: number,
  cssH: number,
  gizmos: readonly Gizmo[],
): void {
  if (g.kind === "point") {
    setWidgetOverride(g.index, [quantize(world.x), quantize(world.y)], sceneKey);
  } else if (g.kind === "distance") {
    setWidgetOverride(
      g.index,
      [quantize(Math.max(0.05, dist(world, g.origin)))],
      sceneKey,
    );
  } else if (g.kind === "glider") {
    const t = Math.min(1, Math.max(0, projectT(g.a, g.b, world)));
    setWidgetOverride(g.index, [quantize(t)], sceneKey);
  } else if (g.kind === "angle") {
    let deg = (Math.atan2(world.y - g.origin.y, world.x - g.origin.x) * 180) / Math.PI;
    if (deg < 0) deg += 360;
    setWidgetOverride(g.index, [Math.round(deg) % 360], sceneKey);
  } else {
    setWidgetOverride(
      g.index,
      [numberValueFromPointer(g, screen.x, cssW, cssH, gizmos)],
      sceneKey,
    );
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
    canvas.style.cursor = h.gizmo.kind === "number" ? "ew-resize" : "grab";
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
      applyDrag(g, screenToWorld(cam, p, w, height), p, w, height, frame.gizmos);
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
    canvas.style.cursor =
      nextG?.kind === "number"
        ? "ew-resize"
        : nextG
          ? "grab"
          : nextId
            ? "pointer"
            : "crosshair";
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
  clearWidgetOverrides(sceneKey);
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
  import.meta.hot.accept("./scenes/beam-shared.ts", (mod) => {
    if (!mod || !("scene" in mod) || sceneKey !== "shared") return;
    reloadScene(mod as unknown as SceneModule);
  });
  import.meta.hot.accept("./scenes/plate.ts", (mod) => {
    if (!mod || !("scene" in mod)) return;
    if (sceneKey === "plate") {
      reloadScene(mod as unknown as SceneModule);
      return;
    }
    if (sceneKey === "nest") {
      peekCache.clear();
      evaluate();
      render();
    }
  });
  import.meta.hot.accept("./scenes/nest.ts", (mod) => {
    if (!mod || !("scene" in mod) || sceneKey !== "nest") return;
    reloadScene(mod as unknown as SceneModule);
  });
  import.meta.hot.accept("./scenes/relative.ts", (mod) => {
    if (!mod || !("scene" in mod) || sceneKey !== "relative") return;
    reloadScene(mod as unknown as SceneModule);
  });
  import.meta.hot.accept("./scenes/gear.ts", (mod) => {
    if (!mod || !("scene" in mod) || sceneKey !== "gear") return;
    reloadScene(mod as unknown as SceneModule);
  });
  import.meta.hot.accept("./scenes/ring.ts", (mod) => {
    if (!mod || !("scene" in mod) || sceneKey !== "ring") return;
    reloadScene(mod as unknown as SceneModule);
  });
  import.meta.hot.accept("./scenes/cylinder.ts", (mod) => {
    if (!mod || !("scene" in mod) || sceneKey !== "cylinder") return;
    reloadScene(mod as unknown as SceneModule);
  });
}

void peekFile(SCENE_PEEK).then(() => {
  evaluate();
  render();
});
}
