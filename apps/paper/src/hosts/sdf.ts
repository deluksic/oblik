import {
  beginWidgetFrame3,
  clearWidgetOverrides3,
  getGizmos3,
  gizmoValues3,
  setWidgetOverride3,
  type Gizmo3,
} from "@design-scenes/euclid3";
import { SdfView, type Sdf } from "@design-scenes/sdf";
import type { PaneHandle, ViewHost } from "@design-scenes/shell";
import {
  commitWidget,
  countEditCalls,
  peekFile,
  quantize,
  widgetCountError,
} from "../inspect.ts";
import { subscribeSceneHot } from "../scene-loaders.ts";

type SceneMod = {
  view: "sdf";
  scene: () => Sdf;
  sceneFile: string;
  hint?: string;
};

export const sdfHost: ViewHost = {
  mount(canvas, mod, ctx): PaneHandle {
    let sceneMod = mod as unknown as SceneMod;
    const view = new SdfView(canvas);
    const peekCache = new Map<string, string>();
    const els = ctx.inspect;

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
        const source = peekCache.get(`apps/paper/src/scenes/${ctx.sceneFile}`);
        if (source) {
          error = widgetCountError(gizmos.length, countEditCalls(source));
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
        : (sceneMod.hint ??
          "Field view — not pickable · coral glider writes this file · LMB orbit");
      els.errorEl.hidden = !error;
      els.errorEl.textContent = error ?? "";
      if (hoverGizmo) {
        els.crumbEl.textContent = `widget ${hoverGizmo.kind} #${hoverGizmo.index} · writes ${ctx.sceneFile}`;
        els.metaEl.textContent =
          "The field has no provenance. Widget values live in this scene file.";
        els.sourceEl.innerHTML = `<code class="empty">Widget values are the numeric arguments of edit* in ${ctx.sceneFile}.</code>`;
      } else {
        els.crumbEl.textContent = "Nothing selected";
        els.metaEl.textContent =
          "The field itself is not pickable. Drag a coral handle, or edit a 2D pane.";
        els.sourceEl.innerHTML = `<code class="empty">No surface identity in this view.</code>`;
      }
    }

    function onPointerDown(e: PointerEvent): void {
      ctx.onFocus();
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
    }

    function onPointerMove(e: PointerEvent): void {
      if (drag) {
        const g = gizmos.find((x) => x.index === drag?.index);
        if (g) {
          if (g.kind === "point3") {
            const p = view.dragPoint(g, e.clientX, e.clientY);
            if (p) {
              setWidgetOverride3(g.index, [
                quantize(p.x),
                quantize(p.y),
                quantize(p.z),
              ]);
            }
          } else if (g.kind === "distance3") {
            const d = view.dragDistance(g.origin, e.clientX, e.clientY);
            if (d != null) setWidgetOverride3(g.index, [quantize(d)]);
          } else {
            const t = view.dragGlider(g.a, g.b, e.clientX, e.clientY);
            if (t != null) setWidgetOverride3(g.index, [quantize(t)]);
          }
          evaluate();
          ctx.onLiveChange();
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
    }

    async function onPointerUp(): Promise<void> {
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
        const err = await commitWidget(ctx.sceneFile, g.index, now);
        if (err) error = err;
        else peekCache.delete(`apps/paper/src/scenes/${ctx.sceneFile}`);
      }
      sync();
    }

    function onPointerCancel(): void {
      view.controls.enabled = true;
      drag = null;
      sync();
    }

    const onWinResize = () => view.resize();
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerCancel);
    window.addEventListener("resize", onWinResize);
    const pane = canvas.parentElement;
    const ro =
      pane && typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => view.resize())
        : null;
    if (pane && ro) ro.observe(pane);

    const unsub = subscribeSceneHot((path, next) => {
      if (path !== `./scenes/${ctx.sceneFile}`) return;
      if (!("scene" in next)) return;
      sceneMod = next as unknown as SceneMod;
      clearWidgetOverrides3();
      peekCache.clear();
      void peekFile(peekCache, `apps/paper/src/scenes/${ctx.sceneFile}`).then(
        () => {
          evaluate();
          sync();
        },
      );
    });

    void peekFile(peekCache, `apps/paper/src/scenes/${ctx.sceneFile}`).then(
      () => {
        evaluate();
        sync();
      },
    );

    return {
      refresh(opts) {
        evaluate();
        sync(opts?.quiet ?? false);
      },
      dispose() {
        unsub();
        canvas.removeEventListener("pointerdown", onPointerDown);
        canvas.removeEventListener("pointermove", onPointerMove);
        canvas.removeEventListener("pointerup", onPointerUp);
        canvas.removeEventListener("pointercancel", onPointerCancel);
        window.removeEventListener("resize", onWinResize);
        ro?.disconnect();
        clearWidgetOverrides3();
      },
    };
  },
};
