import { breadcrumb, type Geom3 } from "@design-scenes/geom";
import {
  clearWidgetOverrides3,
  gizmoValues3,
  runScene3,
  setWidgetOverride3,
  SpaceView,
  type Frame3,
  type Gizmo3,
  type SceneModule3,
} from "@design-scenes/euclid3";
import * as mill from "./scenes/mill.ts";
import "./scenes/plate.ts";
import {
  commitWidget,
  countEditCalls,
  peekFile,
  quantize,
  renderSnippet,
  type InspectEls,
} from "./inspect.ts";

export type Paper3dOpts = {
  split?: boolean;
};

export type Paper3dHandle = {
  refresh: (opts?: { quiet?: boolean }) => void;
};

export function startPaper3d(
  els: InspectEls,
  opts: Paper3dOpts = {},
): Paper3dHandle {
  const canvas = document.querySelector<HTMLCanvasElement>("#space")!;
  const paper = document.querySelector<HTMLCanvasElement>("#paper")!;
  if (!opts.split) {
    paper.hidden = true;
    canvas.hidden = false;
  }

  let sceneMod: SceneModule3 = mill;
  const space = new SpaceView(canvas);
  const peekCache = new Map<string, string>();

  let frame: Frame3 | null = null;
  let lastGood: Frame3 | null = null;
  let error: string | null = null;
  let hoverId: string | null = null;
  let selectedId: string | null = null;
  let hoverGizmo: Gizmo3 | null = null;
  let selectedGeom: Geom3 | null = null;
  let drag: { index: number; start: number[] } | null = null;

  function evaluate(): void {
    try {
      frame = runScene3(sceneMod);
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
  }

  function sync(quiet = false): void {
    space.resize();
    space.sync(
      frame?.drawables ?? [],
      frame?.gizmos ?? [],
      hoverId,
      selectedId,
      drag?.index ?? hoverGizmo?.index ?? null,
    );
    if (quiet && !error) return;
    els.statusEl.textContent = error
      ? "Last good frame · scene threw"
      : opts.split
        ? "Drag 2D handles — mill follows live · coral glider is thickness · LMB orbit"
        : "XY from plate.ts (no gizmos) · coral glider = thickness · LMB orbit · RMB pan · wheel zoom";
    els.errorEl.hidden = !error;
    els.errorEl.textContent = error ?? "";
    void updateInspect();
  }

  function refresh(refreshOpts?: { quiet?: boolean }): void {
    evaluate();
    sync(refreshOpts?.quiet ?? false);
  }

  async function updateInspect(): Promise<void> {
    if (hoverGizmo) {
      els.crumbEl.textContent = `widget ${hoverGizmo.kind} #${hoverGizmo.index} · writes ${sceneMod.sceneFile}`;
      els.metaEl.textContent =
        "Coral handles are scene widgets. Numbers live in the scene file and are written on pointer-up.";
      els.sourceEl.innerHTML = `<code class="empty">Widget values are the numeric arguments of edit* in ${sceneMod.sceneFile}.</code>`;
      return;
    }
    const g =
      frame?.drawables.find((d) => d.geom.id === (hoverId ?? selectedId))
        ?.geom ?? selectedGeom;
    if (!g) {
      els.crumbEl.textContent = "Nothing selected";
      els.metaEl.textContent = opts.split
        ? "Stock XY, holes, pocket, and slot come from the 2D plate. Only thickness is a widget here."
        : "Stock XY, holes, pocket, and slot come from plate.ts. Only thickness is a widget here.";
      els.sourceEl.innerHTML = `<code class="empty">Select geometry to see the creation site.</code>`;
      return;
    }
    els.crumbEl.textContent = breadcrumb(g.path);
    els.metaEl.textContent = `${g.id} · ${g.provenance.file}:${g.provenance.line}:${g.provenance.column}`;
    try {
      const text = await peekFile(peekCache, g.provenance.file);
      els.sourceEl.innerHTML = renderSnippet(text, g.provenance.line);
    } catch (err) {
      els.sourceEl.innerHTML = `<code class="empty">${err instanceof Error ? err.message : String(err)}</code>`;
    }
  }

  canvas.addEventListener("pointerdown", (e) => {
    canvas.focus();
    if (e.button !== 0) return;
    const h = space.hitTest(e.clientX, e.clientY);
    if (h?.target === "gizmo") {
      space.controls.enabled = false;
      drag = { index: h.gizmo.index, start: gizmoValues3(h.gizmo) };
      canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
      e.stopPropagation();
      sync();
      return;
    }
    if (h?.target === "geom") {
      selectedId = h.geom.id;
      selectedGeom = h.geom;
      peekCache.delete(h.geom.provenance.file);
      sync();
      return;
    }
    selectedId = null;
    selectedGeom = null;
    sync();
  });

  canvas.addEventListener("pointermove", (e) => {
    if (drag && frame) {
      const g = frame.gizmos.find((x) => x.index === drag?.index);
      if (g) {
        if (g.kind === "point3") {
          const p = space.dragPoint(g, e.clientX, e.clientY);
          if (p) setWidgetOverride3(g.index, [quantize(p.x), quantize(p.y), quantize(p.z)]);
        } else if (g.kind === "distance3") {
          const d = space.dragDistance(g.origin, e.clientX, e.clientY);
          if (d != null) setWidgetOverride3(g.index, [quantize(d)]);
        } else {
          const t = space.dragGlider(g.a, g.b, e.clientX, e.clientY);
          if (t != null) setWidgetOverride3(g.index, [quantize(t)]);
        }
        evaluate();
        sync();
      }
      return;
    }
    const h = space.hitTest(e.clientX, e.clientY);
    const nextId = h?.target === "geom" ? h.geom.id : null;
    const nextG = h?.target === "gizmo" ? h.gizmo : null;
    if (nextId !== hoverId || nextG?.index !== hoverGizmo?.index) {
      hoverId = nextId;
      hoverGizmo = nextG;
      canvas.style.cursor = nextG ? "grab" : nextId ? "pointer" : "crosshair";
      sync();
    }
  });

  canvas.addEventListener("pointerup", async () => {
    space.controls.enabled = true;
    if (!drag || !frame) {
      sync();
      return;
    }
    const dragging = drag;
    const g = frame.gizmos.find((x) => x.index === dragging.index);
    drag = null;
    if (!g) {
      sync();
      return;
    }
    const now = gizmoValues3(g);
    const changed = now.some((v, i) => v !== dragging.start[i]);
    if (changed) {
      const err = await commitWidget(sceneMod.sceneFile, g.index, now);
      if (err) error = err;
      else peekCache.delete(`apps/paper/src/scenes/${sceneMod.sceneFile}`);
    }
    sync();
  });

  canvas.addEventListener("pointercancel", () => {
    space.controls.enabled = true;
    drag = null;
    sync();
  });

  window.addEventListener("resize", () => {
    space.resize();
  });
  const pane = canvas.parentElement;
  if (pane && typeof ResizeObserver !== "undefined") {
    new ResizeObserver(() => space.resize()).observe(pane);
  }

  if (import.meta.hot) {
    import.meta.hot.accept("./scenes/mill.ts", (mod) => {
      if (!mod || !("scene" in mod)) return;
      sceneMod = mod as unknown as SceneModule3;
      clearWidgetOverrides3();
      peekCache.clear();
      void peekFile(peekCache, `apps/paper/src/scenes/${sceneMod.sceneFile}`).then(
        () => {
          evaluate();
          sync();
        },
      );
    });
    // plate.ts drives XY; keep the in-memory thickness override if mill.ts did not change.
    import.meta.hot.accept("./scenes/plate.ts", () => {
      evaluate();
      sync(true);
    });
  }

  void peekFile(peekCache, `apps/paper/src/scenes/${sceneMod.sceneFile}`).then(
    () => {
      evaluate();
      sync(opts.split);
    },
  );

  return { refresh };
}
