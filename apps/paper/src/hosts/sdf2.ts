import { dist, type Vec2 } from "@design-scenes/geom";
import {
  beginWidgetFrame,
  clearWidgetOverrides,
  drawGizmoOverlay,
  getGizmos,
  gizmoValues,
  hitTest,
  publishWidgetOverrides,
  resizeCanvas,
  screenToWorld,
  setWidgetOverride,
  zoomAt,
  type Camera,
  type Gizmo,
} from "@design-scenes/euclid2";
import { fillSdf2, type Sdf2 } from "@design-scenes/sdf";
import type { PaneHandle, ViewHost } from "@design-scenes/shell";
import {
  commitEditors,
  commitWidget,
  peekFile,
  quantize,
} from "../inspect.ts";
import { subscribeSceneHot } from "../scene-loaders.ts";
import {
  drawEditorGhost,
  EDITOR_COMMANDS,
  editorStatus,
  radiusBetween,
  type EditorTool,
} from "./editors.ts";

type SceneMod = {
  view: "sdf2";
  scene: () => Sdf2;
  sceneFile: string;
  hint?: string;
  camera?: Camera;
};

function asCamera(mod: Record<string, unknown>): Camera {
  const c = mod.camera;
  if (
    c &&
    typeof c === "object" &&
    "x" in c &&
    "y" in c &&
    "scale" in c &&
    typeof (c as Camera).x === "number"
  ) {
    return {
      x: (c as Camera).x,
      y: (c as Camera).y,
      scale: (c as Camera).scale,
    };
  }
  return { x: 0.2, y: 0.32, scale: 110 };
}

function drawAxes(
  ctx2d: CanvasRenderingContext2D,
  w: number,
  h: number,
  cam: Camera,
): void {
  const ox = w / 2 + (0 - cam.x) * cam.scale;
  const oy = h / 2 - (0 - cam.y) * cam.scale;
  ctx2d.strokeStyle = "#3a4156";
  ctx2d.lineWidth = 1.25;
  ctx2d.beginPath();
  ctx2d.moveTo(0, oy);
  ctx2d.lineTo(w, oy);
  ctx2d.moveTo(ox, 0);
  ctx2d.lineTo(ox, h);
  ctx2d.stroke();
  ctx2d.fillStyle = "#8b93a7";
  ctx2d.font = "600 11px system-ui, sans-serif";
  ctx2d.fillText("r", w - 18, oy - 8);
  ctx2d.fillText("z", ox + 8, 16);
}

export const sdf2Host: ViewHost = {
  mount(canvas, mod, ctx): PaneHandle {
    let sceneMod = mod as unknown as SceneMod;
    const sceneId = ctx.sceneId;
    const els = ctx.inspect;
    let sdf: Sdf2 | null = null;
    let gizmos: readonly Gizmo[] = [];
    let error: string | null = null;
    let cam = asCamera(mod);
    let hoverGizmo: Gizmo | null = null;
    let drag: { site: string; start: number[]; gizmo: Gizmo } | null = null;
    let pan: { x: number; y: number; camX: number; camY: number } | null = null;
    let tool: EditorTool | null = null;
    let ghost: Vec2 | null = null;
    const peekCache = new Map<string, string>();

    function cssSize(): { w: number; h: number } {
      const r = canvas.getBoundingClientRect();
      return { w: r.width, h: r.height };
    }

    function eventPos(e: PointerEvent): Vec2 {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    function evaluate(propagate = true): void {
      try {
        beginWidgetFrame(sceneId);
        sdf = sceneMod.scene();
        gizmos = getGizmos();
        error = null;
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }
      publishWidgetOverrides(sceneId);
      if (propagate) ctx.onLiveChange();
    }

    function render(quiet = false): void {
      resizeCanvas(canvas);
      const { w, h } = cssSize();
      const ctx2d = canvas.getContext("2d");
      if (!ctx2d) return;
      ctx2d.fillStyle = "#12141c";
      ctx2d.fillRect(0, 0, w, h);
      if (sdf) fillSdf2(ctx2d, w, h, cam, sdf);
      drawAxes(ctx2d, w, h, cam);
      drawGizmoOverlay(
        ctx2d,
        w,
        h,
        cam,
        gizmos,
        drag?.site ?? hoverGizmo?.site ?? null,
      );
      if (tool) drawEditorGhost(ctx2d, cam, w, h, tool, ghost);
      if (quiet && !error) return;
      els.statusEl.textContent = error
        ? "Last good frame · scene threw"
        : editorStatus(
            tool,
            sceneMod.hint ??
              "Space adds an editor · X radial, Y is Z",
          );
      els.errorEl.hidden = !error;
      els.errorEl.textContent = error ?? "";
      if (hoverGizmo) {
        els.crumbEl.textContent = `widget ${hoverGizmo.kind} ${hoverGizmo.site} · writes ${ctx.sceneFile}`;
        els.metaEl.textContent =
          "Handles are scene widgets. The filled blob is the 2D SDF.";
        els.sourceEl.innerHTML = `<code class="empty">Widget values are the numeric arguments of edit* in ${ctx.sceneFile}.</code>`;
      } else {
        els.crumbEl.textContent = "Nothing selected";
        els.metaEl.textContent =
          "Drag a centre or dashed radius. This field is swept in 3D around each rim.";
        els.sourceEl.innerHTML = `<code class="empty">No surface identity in this view.</code>`;
      }
    }

    function applyDrag(g: Gizmo, world: Vec2): void {
      if (g.kind === "point") {
        setWidgetOverride(
          g.site,
          [quantize(world.x), quantize(world.y)],
          sceneId,
        );
      } else if (g.kind === "distance") {
        setWidgetOverride(
          g.site,
          [quantize(Math.max(0.02, dist(world, g.origin)))],
          sceneId,
        );
      } else if (g.kind === "vector") {
        setWidgetOverride(
          g.site,
          [quantize(world.x - g.origin.x), quantize(world.y - g.origin.y)],
          sceneId,
        );
      }
    }

    async function finishPoint(world: Vec2): Promise<void> {
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
      world: Vec2,
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
      const { w, h } = cssSize();
      const hit = hitTest(p, cam, w, h, gizmos, []);
      if (e.button === 1 || e.altKey) {
        pan = { x: p.x, y: p.y, camX: cam.x, camY: cam.y };
        canvas.setPointerCapture(e.pointerId);
        e.preventDefault();
        return;
      }
      if (e.button !== 0) return;
      if (tool) {
        const world = screenToWorld(cam, p, w, h);
        e.preventDefault();
        if (tool.id === "point") {
          void finishPoint(world);
          return;
        }
        if (!tool.origin) {
          if (hit?.target === "gizmo" && hit.gizmo.kind === "point") {
            tool = {
              id: "distance",
              origin: {
                x: hit.gizmo.x,
                y: hit.gizmo.y,
                at: hit.gizmo.at,
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
      if (hit?.target === "gizmo") {
        drag = { site: hit.gizmo.site, start: gizmoValues(hit.gizmo), gizmo: hit.gizmo };
        canvas.setPointerCapture(e.pointerId);
        e.preventDefault();
        render();
        return;
      }
      pan = { x: p.x, y: p.y, camX: cam.x, camY: cam.y };
      canvas.setPointerCapture(e.pointerId);
      render();
    }

    function onPointerMove(e: PointerEvent): void {
      const { w, h } = cssSize();
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
        ghost = screenToWorld(cam, p, w, h);
        render(true);
        return;
      }
      if (drag) {
        applyDrag(drag.gizmo, screenToWorld(cam, p, w, h));
        evaluate();
        render();
        return;
      }
      const hit = hitTest(p, cam, w, h, gizmos, []);
      const next = hit?.target === "gizmo" ? hit.gizmo : null;
      if (next?.site !== hoverGizmo?.site) {
        hoverGizmo = next;
        canvas.style.cursor = next ? "grab" : "crosshair";
        render();
      }
    }

    async function onPointerUp(): Promise<void> {
      if (pan) {
        pan = null;
        return;
      }
      if (!drag) {
        render();
        return;
      }
      const dragging = drag;
      const g = gizmos.find((x) => x.site === dragging.site);
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
      sceneMod = next as unknown as SceneMod;
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
