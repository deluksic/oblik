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
import { type Geom3 } from "@design-scenes/geom";
import { SdfView, type Sdf } from "@design-scenes/sdf";
import type { PaneHandle, ViewHost } from "@design-scenes/shell";
import { subscribeHelperHot, subscribeSceneHot, inspectSnapshotKey } from "@design-scenes/shell";

import { mapStack, pinConstructorSite, quantize, renderStackSnippets, stackLabel } from "./inspect";
import { applyStyleAtSite, drawInkFromStyle, hasStoredStyle, inspectStylePatch, restInkFromDraw, styleChannelForKind } from "./style";
import type { ObjectStyle } from "@design-scenes/shell";
import {
  commitGizmoIfChanged,
  movedPastClick,
  observePaneResize,
  pruneSelection,
  scenePeekPath,
  setPaneStatus,
  showEmptyInspect,
  showWidgetInspect,
  subscribeHotReload,
  warmPeek,
  type InspectPush,
  type Selection,
} from "./pane";

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
  dispose(): void;
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
      const peekPath = scenePeekPath(ctx.sceneFile);
      const peekCache = new Map<string, string>();
      let lastInspectKey = "";

      const pushInspect: InspectPush = (patch) => {
        if (!ctx.onInspect) return;
        const key = inspectSnapshotKey(patch);
        if (key === lastInspectKey) return;
        lastInspectKey = key;
        ctx.onInspect(patch);
      };

      let sceneMod = mod as Record<string, unknown>;
      let error: string | null = null;
      let hoverGizmo: Gizmo3 | null = null;
      let drag: {
        start: number[];
        gizmo: Gizmo3;
        x: number;
        y: number;
        moved: boolean;
      } | null = null;
      let selected: Selection | null = null;

      // space-only
      const space = mode === "space" ? new SpaceView(canvas) : null;
      if (space) applyCamera3(space, mod);
      let frame: Frame3 | null = null;
      let lastGood: Frame3 | null = null;
      let hoverId: string | null = null;

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
        selected = pruneSelection(
          selected,
          (frame?.drawables ?? []).map((d) => d.geom.id),
          gizmos().map((g) => g.id),
        );
      }

      function hoverGizmoSite(): string | null {
        return drag?.gizmo.site ?? hoverGizmo?.site ?? null;
      }

      function selectedGizmoId(): string | null {
        return selected?.target === "gizmo" ? selected.id : null;
      }

      function selectedGeomId(): string | null {
        return selected?.target === "geom" ? selected.id : null;
      }

      function restOf(id: string) {
        const geom = frame?.drawables.find((d) => d.geom.id === id)?.geom;
        if (geom) {
          return restInkFromDraw(drawInkFromStyle(geom.style, styleChannelForKind(geom.kind)));
        }
        const gizmo = gizmos().find((g) => g.id === id);
        if (!gizmo) return undefined;
        const owner = frame?.drawables.find((d) => d.geom.id === gizmo.id)?.geom;
        return restInkFromDraw(
          drawInkFromStyle(owner?.style ?? gizmo.style, styleChannelForKind(gizmo.kind)),
        );
      }

      function applyStyleLive(style: ObjectStyle | null): void {
        sync(true);
        pushInspect({ style: hasStoredStyle(style) ? style : null });
      }

      async function refreshInspectOrigin(at: { file: string; line: number; column: number }): Promise<void> {
        peekCache.delete(at.file);
        const f = focused();
        if (!f) return;
        if (f.target === "gizmo") {
          const raw =
            f.gizmo.stack && f.gizmo.stack.length > 0
              ? f.gizmo.stack
              : [{ file: f.gizmo.at.file, line: f.gizmo.at.line, column: f.gizmo.at.column }];
          const stack = pinConstructorSite(await mapStack(raw), f.gizmo.at);
          pushInspect({ sourceHtml: await renderStackSnippets(stack, peekCache) });
          return;
        }
        const stack = pinConstructorSite(await mapStack(f.geom.provenance.stack ?? []), f.geom.site);
        pushInspect({ sourceHtml: await renderStackSnippets(stack, peekCache) });
      }

      function styleExtras(
        kind: string,
        current: Parameters<typeof inspectStylePatch>[0],
        at?: { file: string; line: number; column: number },
      ) {
        return inspectStylePatch(
          current,
          kind,
          at,
          (style) => {
            if (at) applyStyleAtSite(at, style, frame?.drawables ?? [], gizmos());
            applyStyleLive(style);
          },
          at ? () => refreshInspectOrigin(at) : undefined,
        );
      }

      function focused():
        | { target: "gizmo"; gizmo: Gizmo3 }
        | { target: "geom"; geom: Geom3 }
        | null {
        if (hoverGizmo) return { target: "gizmo", gizmo: hoverGizmo };
        if (hoverId) {
          const geom = frame?.drawables.find((d) => d.geom.id === hoverId)?.geom;
          if (geom) return { target: "geom", geom };
        }
        if (selected?.target === "gizmo") {
          const id = selected.id;
          const gizmo = gizmos().find((g) => g.id === id);
          if (gizmo) return { target: "gizmo", gizmo };
        }
        if (selected?.target === "geom") {
          const id = selected.id;
          const geom = frame?.drawables.find((d) => d.geom.id === id)?.geom;
          if (geom) return { target: "geom", geom };
        }
        return null;
      }

      async function updateInspect(): Promise<void> {
        const f = focused();
        if (!f) {
          if (mode === "field") {
            showEmptyInspect(
              pushInspect,
              "Nothing selected",
              "Click a handle to keep it in the sidebar. The field itself is not pickable.",
              `<code class="empty">No surface identity in this view.</code>`,
            );
            return;
          }
          showEmptyInspect(
            pushInspect,
            "Nothing selected",
            hintOf(sceneMod, "LMB orbit · RMB pan · wheel zoom · click a handle or a surface"),
            `<code class="empty">Select something to see where it comes from.</code>`,
          );
          return;
        }
        if (f.target === "gizmo") {
          await showWidgetInspect(
            pushInspect,
            peekCache,
            f.gizmo,
            mode === "space"
              ? "Handles are scene widgets. Numbers live in the scene file and are written on pointer-up."
              : "The field has no provenance. Widget values live in this scene file.",
            styleExtras(
              f.gizmo.kind,
              frame?.drawables.find((d) => d.geom.id === f.gizmo.id)?.geom.style ?? f.gizmo.style,
              f.gizmo.at,
            ),
          );
          return;
        }
        const g = f.geom;
        const stack = pinConstructorSite(await mapStack(g.provenance.stack ?? []), g.site);
        pushInspect({
          crumb: g.bind ?? g.kind,
          meta: stackLabel(stack) || `${g.provenance.file}:${g.provenance.line}:${g.provenance.column}`,
          sourceHtml: await renderStackSnippets(stack, peekCache),
          ...styleExtras(g.kind, g.style, g.site),
        });
      }

      function sync(quiet = false): void {
        view.resize();
        if (mode === "space") {
          space!.sync(
            frame?.drawables ?? [],
            frame?.gizmos ?? [],
            hoverId,
            selectedGeomId(),
            hoverGizmoSite(),
            selectedGizmoId(),
            restOf,
          );
        } else {
          if (sdf) fieldView!.setSdf(sdf);
          fieldView!.syncGizmos(fieldGizmos, hoverGizmoSite(), selectedGizmoId(), restOf);
        }
        if (quiet && !error) return;
        const fallback =
          mode === "space"
            ? hintOf(sceneMod, "LMB orbit · RMB pan · wheel zoom · glider writes this file")
            : hintOf(sceneMod, "Field view — not pickable · glider writes this file · LMB orbit");
        setPaneStatus(pushInspect, error ? "Last good frame · scene threw" : fallback, error);
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
            start: gizmoValues3(h.gizmo),
            gizmo: h.gizmo,
            x: e.clientX,
            y: e.clientY,
            moved: false,
          };
          canvas.setPointerCapture(e.pointerId);
          e.preventDefault();
          e.stopPropagation();
          sync();
          return;
        }
        if (mode === "space" && h?.target === "geom") {
          selected = { target: "geom", id: h.geom.id };
          peekCache.delete(h.geom.provenance.file);
          sync();
          return;
        }
        selected = null;
        sync();
      }

      function onPointerMove(e: PointerEvent): void {
        if (drag) {
          if (!drag.moved) {
            if (!movedPastClick(drag.x, drag.y, e.clientX, e.clientY)) return;
            drag.moved = true;
          }
          applyGizmoDrag(view, drag.gizmo, e.clientX, e.clientY);
          evaluate();
          ctx.onLiveChange();
          sync();
          return;
        }
        const h = view.hitTest(e.clientX, e.clientY);
        const nextId = mode === "space" && h?.target === "geom" ? h.geom.id : null;
        const nextG = h?.target === "gizmo" ? h.gizmo : null;
        if (nextId !== hoverId || nextG?.id !== hoverGizmo?.id) {
          hoverId = nextId;
          hoverGizmo = nextG;
          canvas.style.cursor = nextG ? "grab" : nextId ? "pointer" : "crosshair";
          sync();
        }
      }

      function onPointerLeave(): void {
        if (drag) return;
        if (!hoverGizmo && !hoverId) return;
        hoverGizmo = null;
        hoverId = null;
        sync();
      }

      async function onPointerUp(): Promise<void> {
        view.controls.enabled = true;
        if (!drag) {
          sync();
          return;
        }
        const dragging = drag;
        drag = null;
        if (!dragging.moved) {
          selected = { target: "gizmo", id: dragging.gizmo.id };
          sync();
          return;
        }
        const g = gizmos().find((x) => x.id === dragging.gizmo.id);
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
      canvas.addEventListener("pointerleave", onPointerLeave);
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
          canvas.removeEventListener("pointerleave", onPointerLeave);
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
