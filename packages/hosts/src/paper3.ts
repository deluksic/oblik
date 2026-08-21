import { clearImportedOverrides } from "@design-scenes/euclid2";
import {
  beginWidgetFrame3,
  clearWidgetOverrides3,
  getGizmos3,
  gizmoValues3,
  runScene3,
  setWidgetOverride3,
  SpaceView,
  type Frame3,
  type Gizmo3,
  type SceneModule3,
} from "@design-scenes/euclid3";
import { breadcrumb, type Geom3 } from "@design-scenes/geom";
import { SdfView, type Sdf } from "@design-scenes/sdf";
import type { PaneHandle, ViewHost } from "@design-scenes/shell";
import { subscribeSceneHot, subscribeHelperHot } from "@design-scenes/shell";

import { peekFile, quantize, renderSnippet } from "./inspect.ts";
import {
  commitGizmoIfChanged,
  observePaneResize,
  scenePeekPath,
  setPaneStatus,
  showEmptyInspect,
  showWidgetInspect,
  subscribeHotReload,
  warmPeek,
} from "./pane.ts";

type FieldSceneMod = {
  view: "sdf";
  scene: () => Sdf;
  sceneFile: string;
  hint?: string;
};

function applyCamera3(space: SpaceView, mod: Record<string, unknown>): void {
  const c = mod.camera3;
  if (!c || typeof c !== "object") return;
  const pos = (c as { position?: unknown }).position;
  const target = (c as { target?: unknown }).target;
  if (Array.isArray(pos) && pos.length >= 3) {
    space.camera.position.set(Number(pos[0]), Number(pos[1]), Number(pos[2]));
  }
  if (Array.isArray(target) && target.length >= 3) {
    space.controls.target.set(Number(target[0]), Number(target[1]), Number(target[2]));
  }
}

function hintOf(mod: Record<string, unknown>, fallback: string): string {
  return typeof mod.hint === "string" ? mod.hint : fallback;
}

type DragView = {
  controls: { enabled: boolean };
  resize(): void;
  hitTest(
    x: number,
    y: number,
  ): { target: "gizmo"; gizmo: Gizmo3 } | { target: "geom"; geom: Geom3 } | null;
  dragPoint(g: Gizmo3, x: number, y: number): { x: number; y: number; z: number } | null;
  dragDistance(origin: { x: number; y: number; z: number }, x: number, y: number): number | null;
  dragGlider(
    a: { x: number; y: number; z: number },
    b: { x: number; y: number; z: number },
    x: number,
    y: number,
  ): number | null;
};

function applyGizmoDrag(view: DragView, g: Gizmo3, clientX: number, clientY: number): void {
  if (g.kind === "point3") {
    const p = view.dragPoint(g, clientX, clientY);
    if (p) {
      setWidgetOverride3(g.site, [quantize(p.x), quantize(p.y), quantize(p.z)]);
    }
  } else if (g.kind === "distance3") {
    const d = view.dragDistance(g.origin, clientX, clientY);
    if (d != null) setWidgetOverride3(g.site, [quantize(d)]);
  } else {
    const t = view.dragGlider(g.a, g.b, clientX, clientY);
    if (t != null) setWidgetOverride3(g.site, [quantize(t)]);
  }
}

function createPaper3Host(mode: "space" | "field"): ViewHost {
  return {
    mount(canvas, mod, ctx): PaneHandle {
      const els = ctx.inspect;
      const peekPath = scenePeekPath(ctx.sceneFile);
      const peekCache = new Map<string, string>();

      let sceneMod = mod as Record<string, unknown>;
      let error: string | null = null;
      let hoverGizmo: Gizmo3 | null = null;
      let drag: { site: string; start: number[]; gizmo: Gizmo3 } | null = null;

      // space-only
      const space = mode === "space" ? new SpaceView(canvas) : null;
      if (space) applyCamera3(space, mod);
      let frame: Frame3 | null = null;
      let lastGood: Frame3 | null = null;
      let hoverId: string | null = null;
      let selectedId: string | null = null;
      let selectedGeom: Geom3 | null = null;

      // field-only
      const fieldView = mode === "field" ? new SdfView(canvas) : null;
      let sdf: Sdf | null = null;
      let fieldGizmos: readonly Gizmo3[] = [];

      const view = (mode === "space" ? space : fieldView) as DragView;
      let closed = false;

      function gizmos(): readonly Gizmo3[] {
        return mode === "space" ? (frame?.gizmos ?? []) : fieldGizmos;
      }

      function evaluate(): void {
        try {
          if (mode === "space") {
            frame = runScene3(sceneMod as unknown as SceneModule3);
            lastGood = frame;
          } else {
            beginWidgetFrame3();
            sdf = (sceneMod as unknown as FieldSceneMod).scene();
            fieldGizmos = getGizmos3();
          }
          error = null;
        } catch (err) {
          error = err instanceof Error ? err.message : String(err);
          if (mode === "space") frame = lastGood;
        }
        if (mode === "space") {
          if (selectedId && !(frame?.drawables.some((d) => d.geom.id === selectedId) ?? false)) {
            selectedId = null;
            selectedGeom = null;
          }
        }
      }

      async function updateInspect(): Promise<void> {
        if (hoverGizmo) {
          const meta =
            mode === "space"
              ? "Handles are scene widgets. Numbers live in the scene file and are written on pointer-up."
              : "The field has no provenance. Widget values live in this scene file.";
          showWidgetInspect(els, hoverGizmo.kind, hoverGizmo.site, hoverGizmo.at.file, meta);
          return;
        }
        if (mode === "field") {
          showEmptyInspect(
            els,
            "Nothing selected",
            "The field itself is not pickable. Drag a handle, or edit a 2D pane.",
            `<code class="empty">No surface identity in this view.</code>`,
          );
          return;
        }
        const g =
          frame?.drawables.find((d) => d.geom.id === (hoverId ?? selectedId))?.geom ?? selectedGeom;
        if (!g) {
          showEmptyInspect(
            els,
            "Nothing selected",
            hintOf(sceneMod, "LMB orbit · RMB pan · wheel zoom · glider writes this file"),
            `<code class="empty">Select geometry to see the creation site.</code>`,
          );
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

      function sync(quiet = false): void {
        view.resize();
        if (mode === "space") {
          space!.sync(
            frame?.drawables ?? [],
            frame?.gizmos ?? [],
            hoverId,
            selectedId,
            drag?.site ?? hoverGizmo?.site ?? null,
          );
        } else {
          if (sdf) fieldView!.setSdf(sdf);
          fieldView!.syncGizmos(fieldGizmos, drag?.site ?? hoverGizmo?.site ?? null);
        }
        if (quiet && !error) return;
        const fallback =
          mode === "space"
            ? hintOf(sceneMod, "LMB orbit · RMB pan · wheel zoom · glider writes this file")
            : hintOf(sceneMod, "Field view — not pickable · glider writes this file · LMB orbit");
        setPaneStatus(els, error ? "Last good frame · scene threw" : fallback, error);
        void updateInspect();
      }

      function onPointerDown(e: PointerEvent): void {
        ctx.onFocus();
        canvas.focus();
        if (e.button !== 0) return;
        const h = view.hitTest(e.clientX, e.clientY);
        if (h?.target === "gizmo") {
          view.controls.enabled = false;
          drag = {
            site: h.gizmo.site,
            start: gizmoValues3(h.gizmo),
            gizmo: h.gizmo,
          };
          canvas.setPointerCapture(e.pointerId);
          e.preventDefault();
          e.stopPropagation();
          sync();
          return;
        }
        if (mode === "space" && h?.target === "geom") {
          selectedId = h.geom.id;
          selectedGeom = h.geom;
          peekCache.delete(h.geom.provenance.file);
          sync();
          return;
        }
        if (mode === "space") {
          selectedId = null;
          selectedGeom = null;
          sync();
        }
      }

      function onPointerMove(e: PointerEvent): void {
        if (drag) {
          applyGizmoDrag(view, drag.gizmo, e.clientX, e.clientY);
          evaluate();
          ctx.onLiveChange();
          sync();
          return;
        }
        const h = view.hitTest(e.clientX, e.clientY);
        const nextId = mode === "space" && h?.target === "geom" ? h.geom.id : null;
        const nextG = h?.target === "gizmo" ? h.gizmo : null;
        if (nextId !== hoverId || nextG?.site !== hoverGizmo?.site) {
          hoverId = nextId;
          hoverGizmo = nextG;
          canvas.style.cursor = nextG ? "grab" : nextId ? "pointer" : "crosshair";
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
        const g = gizmos().find((x) => x.site === dragging.site);
        drag = null;
        const now = g ? gizmoValues3(g) : dragging.start;
        const err = await commitGizmoIfChanged(peekCache, dragging.start, g, now);
        if (err) error = err;
        sync();
      }

      function onPointerCancel(): void {
        view.controls.enabled = true;
        drag = null;
        sync();
      }

      canvas.addEventListener("pointerdown", onPointerDown);
      canvas.addEventListener("pointermove", onPointerMove);
      canvas.addEventListener("pointerup", onPointerUp);
      canvas.addEventListener("pointercancel", onPointerCancel);
      const unobserve = observePaneResize(canvas, () => view.resize());

      function rerunFrame(): void {
        clearWidgetOverrides3();
        evaluate();
        sync();
      }

      function onHotReload(next: Record<string, unknown>): void {
        sceneMod = next;
        peekCache.clear();
        void warmPeek(peekCache, peekPath, () => {
          if (closed) return;
          rerunFrame();
        });
      }

      const unsub = subscribeHotReload(ctx.sceneFile, subscribeSceneHot, onHotReload);
      const unsubHelper = subscribeHelperHot(() => {
        if (closed) return;
        peekCache.clear();
        clearImportedOverrides();
        rerunFrame();
      });

      void warmPeek(peekCache, peekPath, () => {
        if (closed) return;
        evaluate();
        sync();
      });

      return {
        refresh(opts) {
          if (closed) return;
          evaluate();
          sync(opts?.quiet ?? false);
        },
        dispose() {
          if (closed) return;
          closed = true;
          unsub();
          unsubHelper();
          canvas.removeEventListener("pointerdown", onPointerDown);
          canvas.removeEventListener("pointermove", onPointerMove);
          canvas.removeEventListener("pointerup", onPointerUp);
          canvas.removeEventListener("pointercancel", onPointerCancel);
          unobserve();
          view.dispose();
          clearWidgetOverrides3();
        },
      };
    },
  };
}

export const euclid3Host = createPaper3Host("space");
export const sdfHost = createPaper3Host("field");
