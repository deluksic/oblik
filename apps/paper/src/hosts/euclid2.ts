import { breadcrumb, dist, projectT, type Geom } from "@design-scenes/geom";
import {
  clearWidgetOverrides,
  defaultCamera,
  drawFrame,
  gizmoValues,
  hitTest,
  numberValueFromPointer,
  publishWidgetOverrides,
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
import type { PaneHandle, ViewHost } from "@design-scenes/shell";
import {
  commitEditors,
  commitWidget,
  peekFile,
  quantize,
  renderSnippet,
} from "../inspect.ts";
import { subscribeSceneHot } from "../scene-loaders.ts";
import {
  drawEditorGhost,
  EDITOR_COMMANDS,
  editorStatus,
  radiusBetween,
  type EditorTool,
} from "./editors.ts";

function asCamera(mod: Record<string, unknown>): Camera {
  const c = mod.camera;
  if (
    c &&
    typeof c === "object" &&
    "x" in c &&
    "y" in c &&
    "scale" in c &&
    typeof (c as Camera).x === "number" &&
    typeof (c as Camera).y === "number" &&
    typeof (c as Camera).scale === "number"
  ) {
    return { x: (c as Camera).x, y: (c as Camera).y, scale: (c as Camera).scale };
  }
  return defaultCamera();
}

function hintOf(mod: Record<string, unknown>, fallback: string): string {
  return typeof mod.hint === "string" ? mod.hint : fallback;
}

export const euclid2Host: ViewHost = {
  mount(canvas, mod, ctx): PaneHandle {
    let sceneMod = mod as unknown as SceneModule;
    let frame: Frame | null = null;
    let lastGood: Frame | null = null;
    let error: string | null = null;
    let cam = asCamera(mod);
    let hoverId: string | null = null;
    let selectedId: string | null = null;
    let hoverGizmo: Gizmo | null = null;
    let selectedGeom: Geom | null = null;
    let drag: { site: string; start: number[]; gizmo: Gizmo } | null = null;
    let pan: { x: number; y: number; camX: number; camY: number } | null = null;
    let tool: EditorTool | null = null;
    let ghost: { x: number; y: number } | null = null;
    const peekCache = new Map<string, string>();
    const sceneId = ctx.sceneId;
    const els = ctx.inspect;

    function cssSize(): { w: number; h: number } {
      const r = canvas.getBoundingClientRect();
      return { w: r.width, h: r.height };
    }

    function eventPos(e: PointerEvent): { x: number; y: number } {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    function evaluate(propagate = true): void {
      try {
        frame = runScene(sceneMod, sceneId);
        lastGood = frame;
        error = null;
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
      publishWidgetOverrides(sceneId);
      if (propagate) ctx.onLiveChange();
    }

    function activeGizmo(): string | null {
      return drag?.site ?? hoverGizmo?.site ?? null;
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
          title: `widget ${hoverGizmo.kind} ${hoverGizmo.site} · writes ${ctx.sceneFile}`,
        };
      }
      const g =
        frame?.drawables.find((d) => d.geom.id === (hoverId ?? selectedId))
          ?.geom ?? selectedGeom;
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
        els.crumbEl.textContent = "Nothing selected";
        els.metaEl.textContent = hintOf(
          sceneMod as unknown as Record<string, unknown>,
          "Hover geometry or a handle. Numbers live in the scene file.",
        );
        els.sourceEl.innerHTML = `<code class="empty">Select geometry to see the creation site.</code>`;
        return;
      }
      els.crumbEl.textContent = t.title;
      if (t.file == null || t.line == null) {
        els.metaEl.textContent =
          "Handles are scene widgets. Numbers live in the scene file and are written on pointer-up.";
        els.sourceEl.innerHTML = `<code class="empty">Widget values are the numeric arguments of edit* in ${ctx.sceneFile}.</code>`;
        return;
      }
      els.metaEl.textContent = t.id
        ? `${t.id} · ${t.file}:${t.line}:${t.column ?? 0}`
        : `${t.file}:${t.line}:${t.column ?? 0}`;
      try {
        const text = await peekFile(peekCache, t.file);
        els.sourceEl.innerHTML = renderSnippet(text, t.line);
      } catch (err) {
        els.sourceEl.innerHTML = `<code class="empty">${err instanceof Error ? err.message : String(err)}</code>`;
      }
    }

    function render(quiet = false): void {
      resizeCanvas(canvas);
      const { w, h } = cssSize();
      const ctx2d = canvas.getContext("2d");
      if (!ctx2d) return;
      drawFrame(
        ctx2d,
        w,
        h,
        cam,
        frame?.drawables ?? [],
        frame?.gizmos ?? [],
        hoverId,
        selectedId,
        activeGizmo(),
      );
      if (tool) drawEditorGhost(ctx2d, cam, w, h, tool, ghost);
      if (quiet && !error) return;
      els.statusEl.textContent = error
        ? "Last good frame · scene threw"
        : editorStatus(
            tool,
            hintOf(
              sceneMod as unknown as Record<string, unknown>,
              "Space adds an editor · drag handles · wheel zooms",
            ),
          );
      els.errorEl.hidden = !error;
      els.errorEl.textContent = error ?? "";
      void updateInspect();
    }

    function hit(e: PointerEvent) {
      const { w, h } = cssSize();
      return hitTest(
        eventPos(e),
        cam,
        w,
        h,
        frame?.gizmos ?? [],
        frame?.drawables ?? [],
      );
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
        setWidgetOverride(
          g.site,
          [quantize(world.x), quantize(world.y)],
          sceneId,
        );
      } else if (g.kind === "distance") {
        setWidgetOverride(
          g.site,
          [quantize(Math.max(0.05, dist(world, g.origin)))],
          sceneId,
        );
      } else if (g.kind === "glider") {
        const t = Math.min(1, Math.max(0, projectT(g.a, g.b, world)));
        setWidgetOverride(g.site, [quantize(t)], sceneId);
      } else if (g.kind === "angle") {
        let deg =
          (Math.atan2(world.y - g.origin.y, world.x - g.origin.x) * 180) /
          Math.PI;
        if (deg < 0) deg += 360;
        setWidgetOverride(g.site, [Math.round(deg) % 360], sceneId);
      } else if (g.kind === "vector") {
        setWidgetOverride(
          g.site,
          [quantize(world.x - g.origin.x), quantize(world.y - g.origin.y)],
          sceneId,
        );
      } else {
        setWidgetOverride(
          g.site,
          [numberValueFromPointer(g, screen.x, cssW, cssH, gizmos)],
          sceneId,
        );
      }
    }

    async function finishPoint(world: { x: number; y: number }): Promise<void> {
      const err = await commitEditors(ctx.sceneFile, [
        { kind: "point", x: quantize(world.x), y: quantize(world.y) },
      ]);
      tool = null;
      ghost = null;
      if (err) error = err;
      else peekCache.delete(`apps/paper/src/scenes/${ctx.sceneFile}`);
      evaluate();
      render();
    }

    async function finishDistance(
      origin: { x: number; y: number; at?: { line: number; column: number } },
      world: { x: number; y: number },
    ): Promise<void> {
      const d = quantize(radiusBetween(origin, world));
      const edits =
        origin.at != null
          ? [{ kind: "distance" as const, originAt: origin.at, d }]
          : [
              {
                kind: "point" as const,
                x: quantize(origin.x),
                y: quantize(origin.y),
              },
              { kind: "distance" as const, d },
            ];
      const err = await commitEditors(ctx.sceneFile, edits);
      tool = null;
      ghost = null;
      if (err) error = err;
      else peekCache.delete(`apps/paper/src/scenes/${ctx.sceneFile}`);
      evaluate();
      render();
    }

    function onPointerDown(e: PointerEvent): void {
      ctx.onFocus();
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
      if (tool) {
        const { w, h: height } = cssSize();
        const world = screenToWorld(cam, p, w, height);
        e.preventDefault();
        if (tool.id === "point") {
          void finishPoint(world);
          return;
        }
        if (!tool.origin) {
          if (h?.target === "gizmo" && h.gizmo.kind === "point") {
            tool = {
              id: "distance",
              origin: {
                x: h.gizmo.x,
                y: h.gizmo.y,
                at: h.gizmo.at,
              },
            };
            render();
            return;
          }
          tool = { id: "distance", origin: { x: world.x, y: world.y } };
          render();
          return;
        }
        void finishDistance(tool.origin, world);
        return;
      }
      if (h?.target === "gizmo") {
        drag = { site: h.gizmo.site, start: gizmoValues(h.gizmo), gizmo: h.gizmo };
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
    }

    function onPointerMove(e: PointerEvent): void {
      const { w, h: height } = cssSize();
      const p = eventPos(e);
      if (pan) {
        cam = {
          ...cam,
          x: pan.camX - (p.x - pan.x) / cam.scale,
          y: pan.camY + (p.y - pan.y) / cam.scale,
        };
        render(true);
        return;
      }
      if (tool) {
        ghost = screenToWorld(cam, p, w, height);
        render(true);
        return;
      }
      if (drag && frame) {
        applyDrag(
          drag.gizmo,
          screenToWorld(cam, p, w, height),
          p,
          w,
          height,
          frame.gizmos,
        );
        evaluate();
        render();
        return;
      }
      const hitResult = hit(e);
      const nextId =
        hitResult?.target === "geom" ? hitResult.drawable.geom.id : null;
      const nextG = hitResult?.target === "gizmo" ? hitResult.gizmo : null;
      if (nextId !== hoverId || nextG?.site !== hoverGizmo?.site) {
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
    }

    async function onPointerUp(): Promise<void> {
      if (pan) {
        pan = null;
        return;
      }
      if (!drag || !frame) return;
      const dragging = drag;
      const g = frame.gizmos.find((x) => x.site === dragging.site);
      drag = null;
      if (!g) {
        render();
        return;
      }
      const now = gizmoValues(g);
      const changed = now.some((v, i) => v !== dragging.start[i]);
      if (changed) {
        const err = await commitWidget(ctx.sceneFile, g.at, now);
        if (err) error = err;
        else peekCache.delete(`apps/paper/src/scenes/${ctx.sceneFile}`);
      }
      render();
    }

    function onPointerCancel(): void {
      pan = null;
      drag = null;
      render();
    }

    function onWheel(e: WheelEvent): void {
      e.preventDefault();
      const { w, h } = cssSize();
      cam = zoomAt(
        cam,
        { x: e.offsetX, y: e.offsetY },
        w,
        h,
        e.deltaY < 0 ? 1.08 : 1 / 1.08,
      );
      render(true);
    }

    const onWinResize = () => render(true);
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerCancel);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("resize", onWinResize);
    const pane = canvas.parentElement;
    const ro =
      pane && typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => render(true))
        : null;
    if (pane && ro) ro.observe(pane);

    const unsub = subscribeSceneHot((path, next) => {
      if (path !== `./scenes/${ctx.sceneFile}`) return;
      if (!("scene" in next)) return;
      sceneMod = next as unknown as SceneModule;
      clearWidgetOverrides(sceneId);
      peekCache.clear();
      void peekFile(peekCache, `apps/paper/src/scenes/${ctx.sceneFile}`).then(
        () => {
          evaluate();
          render();
        },
      );
    });

    void peekFile(peekCache, `apps/paper/src/scenes/${ctx.sceneFile}`).then(
      () => {
        evaluate();
        render();
      },
    );

    return {
      refresh(opts) {
        evaluate(false);
        render(opts?.quiet ?? false);
      },
      commands: () => EDITOR_COMMANDS,
      runCommand(id) {
        if (id === "point") tool = { id: "point" };
        else if (id === "distance") tool = { id: "distance" };
        else return;
        ghost = null;
        render();
      },
      cancelCommand() {
        if (!tool) return;
        tool = null;
        ghost = null;
        render();
      },
      dispose() {
        unsub();
        canvas.removeEventListener("pointerdown", onPointerDown);
        canvas.removeEventListener("pointermove", onPointerMove);
        canvas.removeEventListener("pointerup", onPointerUp);
        canvas.removeEventListener("pointercancel", onPointerCancel);
        canvas.removeEventListener("wheel", onWheel);
        window.removeEventListener("resize", onWinResize);
        ro?.disconnect();
        clearWidgetOverrides(sceneId);
      },
    };
  },
};
