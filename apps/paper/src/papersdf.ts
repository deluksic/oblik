import { SdfView, type Sdf } from "@design-scenes/sdf";
import {
  beginWidgetFrame3,
  clearWidgetOverrides3,
  getGizmos3,
  gizmoValues3,
  setWidgetOverride3,
  type Gizmo3,
} from "@design-scenes/euclid3";
import * as rose from "./scenes/rose-sdf.ts";
import {
  commitWidget,
  countEditCalls,
  peekFile,
  quantize,
  type InspectEls,
} from "./inspect.ts";

export type PaperSdfHandle = {
  refresh: (opts?: { quiet?: boolean }) => void;
};

export type PaperSdfOpts = {
  split?: boolean;
};

type SceneMod = {
  view: "sdf";
  scene: () => Sdf;
  sceneFile: string;
};

export function startPaperSdf(
  els: InspectEls,
  opts: PaperSdfOpts = {},
): PaperSdfHandle {
  const canvas = document.querySelector<HTMLCanvasElement>("#space")!;
  const paper = document.querySelector<HTMLCanvasElement>("#paper")!;
  if (!opts.split) {
    paper.hidden = true;
    const kickers = document.querySelectorAll("#inspect .kicker");
    if (kickers[0]) kickers[0].textContent = "Widget";
    if (kickers[1]) kickers[1].textContent = "Scene file";
  }
  canvas.hidden = false;

  const spaceLabel = document.querySelector("#pane-space .view-label");
  if (spaceLabel) spaceLabel.textContent = "SDF · rose-sdf.ts";
  const paperLabel = document.querySelector("#pane-paper .view-label");
  if (paperLabel && opts.split) paperLabel.textContent = "2D · cylinder.ts";

  let sceneMod: SceneMod = rose;
  const view = new SdfView(canvas);
  const peekCache = new Map<string, string>();

  let sdf: Sdf | null = null;
  let gizmos: readonly Gizmo3[] = [];
  let error: string | null = null;
  let hoverGizmo: Gizmo3 | null = null;
  let drag: { index: number; start: number[] } | null = null;

  function evaluate(): void {
    try {
      beginWidgetFrame3();
      sdf = sceneMod.scene();
      gizmos = getGizmos3();
      error = null;
      const source = peekCache.get(`apps/paper/src/scenes/${sceneMod.sceneFile}`);
      if (source) {
        const edits = countEditCalls(source);
        if (edits > 0 && gizmos.length !== edits) {
          error = `${gizmos.length} widgets at runtime but ${edits} edit* calls in scene — unroll helpers`;
        }
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  function sync(quiet = false): void {
    view.resize();
    if (sdf) view.setSdf(sdf);
    view.syncGizmos(gizmos, drag?.index ?? hoverGizmo?.index ?? null);
    if (quiet && !error) return;
    els.statusEl.textContent = error
      ? "Last good frame · scene threw"
      : opts.split
        ? "Drag the 2D ring and centre Ø — field follows live · coral glider is height · LMB orbit"
        : "SDF CSG — XY from cylinder.ts · coral glider is height · LMB orbit";
    els.errorEl.hidden = !error;
    els.errorEl.textContent = error ?? "";
    if (hoverGizmo) {
      els.crumbEl.textContent = `widget ${hoverGizmo.kind} #${hoverGizmo.index} · writes ${sceneMod.sceneFile}`;
      els.metaEl.textContent =
        "The field has no provenance. Height is the only 3D widget; ring radius and centre Ø live in cylinder.ts.";
      els.sourceEl.innerHTML = `<code class="empty">Widget values are the numeric arguments of edit* in ${sceneMod.sceneFile}.</code>`;
    } else {
      els.crumbEl.textContent = "Nothing selected";
      els.metaEl.textContent = opts.split
        ? "Plan writes cylinder.ts. Only height is a widget here. The field itself is not pickable."
        : "Ring radius and centre Ø come from cylinder.ts. Only height is a widget here.";
      els.sourceEl.innerHTML = `<code class="empty">No surface identity in this view.</code>`;
    }
  }

  function refresh(refreshOpts?: { quiet?: boolean }): void {
    evaluate();
    sync(refreshOpts?.quiet ?? false);
  }

  canvas.addEventListener("pointerdown", (e) => {
    canvas.focus();
    if (e.button !== 0) return;
    const h = view.hitTest(e.clientX, e.clientY);
    if (h?.target === "gizmo") {
      view.controls.enabled = false;
      drag = { index: h.gizmo.index, start: gizmoValues3(h.gizmo) };
      canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
      e.stopPropagation();
      sync();
    }
  });

  canvas.addEventListener("pointermove", (e) => {
    if (drag) {
      const g = gizmos.find((x) => x.index === drag?.index);
      if (g) {
        if (g.kind === "point3") {
          const p = view.dragPoint(g, e.clientX, e.clientY);
          if (p) setWidgetOverride3(g.index, [quantize(p.x), quantize(p.y), quantize(p.z)]);
        } else if (g.kind === "distance3") {
          const d = view.dragDistance(g.origin, e.clientX, e.clientY);
          if (d != null) setWidgetOverride3(g.index, [quantize(d)]);
        } else {
          const t = view.dragGlider(g.a, g.b, e.clientX, e.clientY);
          if (t != null) setWidgetOverride3(g.index, [quantize(t)]);
        }
        evaluate();
        sync();
      }
      return;
    }
    const h = view.hitTest(e.clientX, e.clientY);
    const next = h?.target === "gizmo" ? h.gizmo : null;
    if (next?.index !== hoverGizmo?.index) {
      hoverGizmo = next;
      canvas.style.cursor = next ? "grab" : "crosshair";
      sync();
    }
  });

  canvas.addEventListener("pointerup", async () => {
    view.controls.enabled = true;
    if (!drag) {
      sync();
      return;
    }
    const dragging = drag;
    const g = gizmos.find((x) => x.index === dragging.index);
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
    view.controls.enabled = true;
    drag = null;
    sync();
  });

  window.addEventListener("resize", () => view.resize());
  const pane = canvas.parentElement;
  if (pane && typeof ResizeObserver !== "undefined") {
    new ResizeObserver(() => view.resize()).observe(pane);
  }

  if (import.meta.hot) {
    import.meta.hot.accept("./scenes/rose-sdf.ts", (mod) => {
      if (!mod || !("scene" in mod)) return;
      sceneMod = mod as unknown as SceneMod;
      clearWidgetOverrides3();
      peekCache.clear();
      void peekFile(peekCache, `apps/paper/src/scenes/${sceneMod.sceneFile}`).then(
        () => {
          evaluate();
          sync();
        },
      );
    });
  }

  void peekFile(peekCache, `apps/paper/src/scenes/${sceneMod.sceneFile}`).then(
    () => {
      evaluate();
      sync();
    },
  );

  return { refresh };
}
