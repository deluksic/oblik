import {
  beginWidgetFrame,
  clearImportedOverrides,
  clearWidgetOverrides,
  defaultCamera,
  drawFrame,
  drawGizmoOverlay,
  getGizmos,
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
import {
  breadcrumb,
  dist,
  projectT,
  type Drawable,
  type Geom,
  type Vec2,
} from "@design-scenes/geom";
import { fillSdf2, type Sdf2 } from "@design-scenes/sdf";
import type { PaneHandle, ViewHost } from "@design-scenes/shell";
import {
  commandBarSnapshotKey,
  evalDerivedScenePoints,
  inspectSnapshotKey,
  namedScenePointNear,
  subscribeHelperHot,
  subscribeSceneHot,
  widgetBindingName,
  widgetInSceneFunction,
} from "@design-scenes/shell";

import {
  commandPreview,
  distanceHoverRadius,
  drawEditorGhost,
  EDITOR_COMMANDS,
  editorStatus,
  GEOM_CONSTRUCTOR_COMMANDS,
  gizmoWorldPoint,
  radiusBetween,
  type EditorTool,
  type GhostSnap,
  type NamedGizmoPick,
} from "./editors";
import { commitEditors, peekFile, quantize, renderSnippet } from "./inspect";
import {
  commitGizmoIfChanged,
  cssSize,
  eventPos,
  observePaneResize,
  scenePeekPath,
  setPaneStatus,
  showEmptyInspect,
  showWidgetInspect,
  subscribeHotReload,
  warmPeek,
  type InspectPush,
} from "./pane";

type Sdf2SceneMod = {
  view: "sdf2";
  scene: () => Sdf2;
  sceneFile: string;
  hint?: string;
  camera?: Camera;
};

function asCamera(mod: Record<string, unknown>, fallback: Camera): Camera {
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
  return fallback;
}

function hintOf(mod: Record<string, unknown>, fallback: string): string {
  return typeof mod.hint === "string" ? mod.hint : fallback;
}

function drawAxes(ctx2d: CanvasRenderingContext2D, w: number, h: number, cam: Camera): void {
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

function applyDrag(
  g: Gizmo,
  world: Vec2,
  screen: Vec2,
  cssW: number,
  cssH: number,
  gizmos: readonly Gizmo[],
  sceneId: string,
): void {
  if (g.kind === "point") {
    setWidgetOverride(g.site, [quantize(world.x), quantize(world.y)], sceneId);
  } else if (g.kind === "distance") {
    setWidgetOverride(g.site, [quantize(Math.max(0.05, dist(world, g.origin)))], sceneId);
  } else if (g.kind === "glider") {
    const t = Math.min(1, Math.max(0, projectT(g.a, g.b, world)));
    setWidgetOverride(g.site, [quantize(t)], sceneId);
  } else if (g.kind === "lineGlider") {
    let s = (world.x - g.origin.x) * g.direction.x + (world.y - g.origin.y) * g.direction.y;
    if (g.min != null) s = Math.max(g.min, s);
    if (g.max != null) s = Math.min(g.max, s);
    setWidgetOverride(g.site, [quantize(s)], sceneId);
  } else if (g.kind === "angle") {
    let deg = (Math.atan2(world.y - g.origin.y, world.x - g.origin.x) * 180) / Math.PI;
    if (deg < 0) deg += 360;
    setWidgetOverride(g.site, [Math.round(deg) % 360], sceneId);
  } else if (g.kind === "vector") {
    setWidgetOverride(
      g.site,
      [quantize(world.x - g.origin.x), quantize(world.y - g.origin.y)],
      sceneId,
    );
  } else {
    setWidgetOverride(g.site, [numberValueFromPointer(g, screen.x, cssW, cssH, gizmos)], sceneId);
  }
}

function createPaper2Host(mode: "geom" | "sdf2"): ViewHost {
  return {
    mount(canvas, mod, ctx): PaneHandle {
      const sceneId = ctx.sceneId;
      const peekPath = scenePeekPath(ctx.sceneFile);
      const peekCache = new Map<string, string>();
      const defaultCam = mode === "geom" ? defaultCamera() : { x: 0.2, y: 0.32, scale: 110 };
      let lastInspectKey = "";
      let lastBarKey = "";

      const pushInspect: InspectPush = (patch) => {
        if (!ctx.onInspect) return;
        const key = inspectSnapshotKey(patch);
        if (key === lastInspectKey) return;
        lastInspectKey = key;
        ctx.onInspect(patch);
      };

      let sceneMod = mod as Record<string, unknown>;
      let cam = asCamera(mod, defaultCam);
      let error: string | null = null;
      let closed = false;
      let hoverGizmo: Gizmo | null = null;
      let drag: { site: string; start: number[]; gizmo: Gizmo } | null = null;
      let pan: { x: number; y: number; camX: number; camY: number } | null = null;
      let tool: EditorTool | null = null;
      let ghost: Vec2 | null = null;
      let snap: GhostSnap | null = null;
      let snapGizmo: Gizmo | null = null;

      // geom-only
      let frame: Frame | null = null;
      let lastGood: Frame | null = null;
      let hoverId: string | null = null;
      let selectedId: string | null = null;
      let selectedGeom: Geom | null = null;

      // sdf2-only
      let sdf: Sdf2 | null = null;
      let sdfGizmos: readonly Gizmo[] = [];

      function gizmos(): readonly Gizmo[] {
        return mode === "geom" ? (frame?.gizmos ?? []) : sdfGizmos;
      }

      function drawables(): readonly Drawable[] {
        return mode === "geom" ? (frame?.drawables ?? []) : [];
      }

      function evaluate(propagate = true): void {
        try {
          if (mode === "geom") {
            frame = runScene(sceneMod as unknown as SceneModule, sceneId);
            lastGood = frame;
          } else {
            beginWidgetFrame(sceneId);
            sdf = (sceneMod as unknown as Sdf2SceneMod).scene();
            sdfGizmos = getGizmos();
          }
          error = null;
        } catch (err) {
          error = err instanceof Error ? err.message : String(err);
          if (mode === "geom") frame = lastGood;
        }
        if (mode === "geom") {
          if (selectedId && !(frame?.drawables.some((d) => d.geom.id === selectedId) ?? false)) {
            selectedId = null;
            selectedGeom = null;
          }
        }
        publishWidgetOverrides(sceneId);
        if (propagate) ctx.onLiveChange();
      }

      function activeGizmo(): string | null {
        return drag?.site ?? snapGizmo?.site ?? hoverGizmo?.site ?? null;
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
            title: `widget ${hoverGizmo.kind} ${hoverGizmo.site} · writes ${hoverGizmo.at.file}`,
          };
        }
        if (mode !== "geom") return null;
        const g =
          frame?.drawables.find((d) => d.geom.id === (hoverId ?? selectedId))?.geom ?? selectedGeom;
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
        if (mode === "sdf2") {
          if (hoverGizmo) {
            showWidgetInspect(
              pushInspect,
              hoverGizmo.kind,
              hoverGizmo.site,
              hoverGizmo.at.file,
              "Handles are scene widgets. The filled blob is the 2D SDF.",
            );
            return;
          }
          showEmptyInspect(
            pushInspect,
            "Nothing selected",
            "Drag a centre or dashed radius. This field is swept in 3D around each rim.",
            `<code class="empty">No surface identity in this view.</code>`,
          );
          return;
        }
        const t = currentTarget();
        if (!t) {
          showEmptyInspect(
            pushInspect,
            "Nothing selected",
            hintOf(sceneMod, "Hover geometry or a handle. Numbers live in the scene file."),
            `<code class="empty">Select geometry to see the creation site.</code>`,
          );
          return;
        }
        pushInspect({
          crumb: t.title,
          meta:
            t.file == null || t.line == null
              ? hoverGizmo
                ? "Handles are scene widgets. Numbers live in the scene file and are written on pointer-up."
                : "Handles are scene widgets. Numbers live in the scene file and are written on pointer-up."
              : t.id
                ? `${t.id} · ${t.file}:${t.line}:${t.column ?? 0}`
                : `${t.file}:${t.line}:${t.column ?? 0}`,
          sourceHtml: await (async () => {
            if (t.file == null || t.line == null) {
              if (hoverGizmo) {
                try {
                  const text = await peekFile(peekCache, hoverGizmo.at.file);
                  return renderSnippet(text, hoverGizmo.at.line);
                } catch (err) {
                  return `<code class="empty">${err instanceof Error ? err.message : String(err)}</code>`;
                }
              }
              return `<code class="empty">Widget values are the numeric arguments of edit* in the source file.</code>`;
            }
            try {
              const text = await peekFile(peekCache, t.file);
              return renderSnippet(text, t.line);
            } catch (err) {
              return `<code class="empty">${err instanceof Error ? err.message : String(err)}</code>`;
            }
          })(),
        });
        return;
      }

      function statusHint(): string {
        if (mode === "sdf2") {
          return hintOf(sceneMod, "Space adds an editor · X radial, Y is Z");
        }
        return hintOf(sceneMod, "Space adds an editor · drag handles · wheel zooms");
      }

      function clearTool(): void {
        tool = null;
        ghost = null;
        snap = null;
        snapGizmo = null;
        ctx.onCommandBar?.(null);
      }

      function syncCommandBar(): void {
        if (!ctx.onCommandBar) return;
        if (!tool) {
          if (lastBarKey !== "") {
            lastBarKey = "";
            ctx.onCommandBar(null);
          }
          return;
        }
        const preview = commandPreview(tool);
        if (!preview) {
          if (lastBarKey !== "") {
            lastBarKey = "";
            ctx.onCommandBar(null);
          }
          return;
        }
        const state = {
          ...preview,
          numberValue: tool.id === "distance" ? (tool.typedRadius ?? "") : "",
          onNumber:
            tool.id === "distance" && tool.origin
              ? (n: number) => {
                  if (!tool || tool.id !== "distance" || !tool.origin) return;
                  void finishDistance(tool.origin, null, n);
                }
              : undefined,
          onNumberDraft:
            tool.id === "distance" && tool.origin
              ? (raw: string) => {
                  if (!tool || tool.id !== "distance") return;
                  const trimmed = raw.trim();
                  const current = tool.typedRadius?.trim() ?? "";
                  if (trimmed === "") {
                    if (current !== "") {
                      tool = { ...tool, typedRadius: undefined };
                      render(true);
                      return;
                    }
                    tool = { id: "distance" };
                    render();
                    return;
                  }
                  if (tool.typedRadius === raw) return;
                  tool = { ...tool, typedRadius: raw };
                  render(true);
                }
              : undefined,
        };
        const key = commandBarSnapshotKey(state);
        if (key === lastBarKey) return;
        lastBarKey = key;
        ctx.onCommandBar(state);
      }

      async function namedPointFromGizmo(
        g: import("@design-scenes/euclid2").PointGizmo,
      ): Promise<NamedGizmoPick | string> {
        const text = await peekFile(peekCache, g.at.file);
        if (!widgetInSceneFunction(text, g.at)) {
          return "That handle is not declared in scene() — pick a point that scene() owns.";
        }
        const name = widgetBindingName(text, g.at);
        if (!name) {
          return "That point is inline, not a named const. Pick a named editPoint in scene().";
        }
        return { name, x: g.x, y: g.y, at: g.at };
      }

      async function namedDistanceFromGizmo(
        g: import("@design-scenes/euclid2").DistanceGizmo,
      ): Promise<string | { name: string }> {
        const text = await peekFile(peekCache, g.at.file);
        if (!widgetInSceneFunction(text, g.at)) {
          return "That handle is not declared in scene() — pick a distance that scene() owns.";
        }
        const name = widgetBindingName(text, g.at);
        if (!name) {
          return "That distance is inline, not a named const.";
        }
        return { name };
      }

      function render(quiet = false): void {
        resizeCanvas(canvas);
        const { w, h } = cssSize(canvas);
        const ctx2d = canvas.getContext("2d");
        if (!ctx2d) return;
        if (mode === "geom") {
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
        } else {
          ctx2d.fillStyle = "#12141c";
          ctx2d.fillRect(0, 0, w, h);
          if (sdf) fillSdf2(ctx2d, w, h, cam, sdf);
          drawAxes(ctx2d, w, h, cam);
          drawGizmoOverlay(ctx2d, w, h, cam, sdfGizmos, activeGizmo());
        }
        if (tool) drawEditorGhost(ctx2d, cam, w, h, tool, ghost, snap);
        if (quiet && !error) {
          if (tool?.id === "distance" && tool.origin) syncCommandBar();
          return;
        }
        setPaneStatus(
          pushInspect,
          error ? "Last good frame · scene threw" : editorStatus(tool, statusHint()),
          error,
        );
        if (tool) syncCommandBar();
        void updateInspect();
      }

      function hit(e: PointerEvent) {
        const { w, h } = cssSize(canvas);
        return hitTest(eventPos(canvas, e), cam, w, h, gizmos(), drawables());
      }

      function peekText(file: string): string | undefined {
        const key = file.replace(/^\/+/, "").replace(/\?.*$/, "");
        return peekCache.get(key) ?? peekCache.get(scenePeekPath(file));
      }

      function scenePointEvals(): { name: string; x: number; y: number }[] {
        const out: { name: string; x: number; y: number }[] = [];
        const seen = new Set<string>();
        const add = (name: string, x: number, y: number) => {
          if (seen.has(name)) return;
          seen.add(name);
          out.push({ name, x, y });
        };
        for (const g of gizmos()) {
          if (g.kind === "point") {
            const cached = peekText(g.at.file);
            if (!cached || !widgetInSceneFunction(cached, g.at)) continue;
            const name = widgetBindingName(cached, g.at);
            if (name) add(name, g.x, g.y);
          } else if (g.kind === "vector") {
            const cached = peekText(g.at.file);
            if (!cached || !widgetInSceneFunction(cached, g.at)) continue;
            const name = widgetBindingName(cached, g.at);
            if (name) add(name, g.dx, g.dy);
          }
        }
        const sceneSrc = peekText(peekPath);
        if (sceneSrc) {
          for (const d of evalDerivedScenePoints(sceneSrc, out)) add(d.name, d.x, d.y);
        }
        return out;
      }

      function namedPointNearWorld(world: Vec2, maxDist = 0.35): NamedGizmoPick | null {
        const src = peekText(peekPath);
        if (!src) return null;
        const hitName = namedScenePointNear(src, world.x, world.y, scenePointEvals(), maxDist);
        if (!hitName) return null;
        const pos = scenePointEvals().find((e) => e.name === hitName.name);
        if (!pos) return null;
        return { name: hitName.name, x: pos.x, y: pos.y };
      }

      function namedPointFromHit(h: ReturnType<typeof hit>, world: Vec2): NamedGizmoPick | null {
        if (h?.target === "gizmo") {
          const p = gizmoWorldPoint(h.gizmo);
          if (p) {
            const named = namedPointNearWorld(p, 0.25);
            if (named) return named;
          }
        }
        if (h?.target === "geom" && h.drawable.geom.kind === "circle") {
          const c = h.drawable.geom.center;
          const named = namedPointNearWorld(c, 0.25);
          if (named) return named;
        }
        return namedPointNearWorld(world);
      }

      function updateSnap(e: PointerEvent, world: Vec2): void {
        snap = null;
        snapGizmo = null;
        if (!tool) return;
        const h = hit(e);
        if (tool.id === "circle" && tool.center) {
          if (h?.target === "gizmo" && h.gizmo.kind === "distance") {
            snapGizmo = h.gizmo;
            snap = {
              kind: "distance",
              x: h.gizmo.origin.x,
              y: h.gizmo.origin.y,
              d: h.gizmo.d,
            };
            const hr = distanceHoverRadius(tool, h.gizmo);
            if (tool.hoverRadius !== hr) tool = { ...tool, hoverRadius: hr };
          } else if (tool.hoverRadius != null) {
            tool = { ...tool, hoverRadius: undefined };
          }
          return;
        }
        if (
          tool.id === "distance" &&
          tool.origin &&
          tool.typedRadius != null &&
          tool.typedRadius.trim() !== ""
        ) {
          return;
        }
        const named = namedPointFromHit(h, world);
        if (named) {
          if (h?.target === "gizmo") snapGizmo = h.gizmo;
          snap = { kind: "point", x: named.x, y: named.y };
        }
      }

      async function resolveLinePoint(
        h: ReturnType<typeof hit>,
        world: Vec2,
      ): Promise<NamedGizmoPick | string> {
        await peekFile(peekCache, peekPath).catch(() => "");
        const named = namedPointFromHit(h, world);
        if (named) return named;
        if (h?.target === "gizmo" && h.gizmo.kind === "point") {
          return namedPointFromGizmo(h.gizmo);
        }
        return "Click a named point in scene().";
      }

      async function finishPoint(world: Vec2): Promise<void> {
        const err = await commitEditors(ctx.sceneFile, [
          { kind: "point", x: quantize(world.x), y: quantize(world.y) },
        ]);
        clearTool();
        if (err) error = err;
        else peekCache.delete(peekPath);
        evaluate();
        render();
      }

      async function finishDistance(
        origin: {
          x: number;
          y: number;
          name?: string;
          at?: { line: number; column: number };
        },
        world: Vec2 | null,
        typedRadius?: number,
      ): Promise<void> {
        const d = quantize(
          typedRadius != null
            ? Math.max(0.05, typedRadius)
            : world
              ? radiusBetween(origin, world)
              : 0,
        );
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
        clearTool();
        if (err) error = err;
        else peekCache.delete(peekPath);
        evaluate();
        render();
      }

      async function finishCircle(center: string, radius: string): Promise<void> {
        const err = await commitEditors(ctx.sceneFile, [{ kind: "circle", center, radius }]);
        clearTool();
        if (err) error = err;
        else peekCache.delete(peekPath);
        evaluate();
        render();
      }

      async function finishLine(a: string, b: string): Promise<void> {
        const err = await commitEditors(ctx.sceneFile, [{ kind: "line", a, b }]);
        clearTool();
        if (err) error = err;
        else peekCache.delete(peekPath);
        evaluate();
        render();
      }

      async function pickCircleCenter(
        g: import("@design-scenes/euclid2").PointGizmo,
      ): Promise<void> {
        const picked = await namedPointFromGizmo(g);
        if (typeof picked === "string") {
          error = picked;
          render();
          return;
        }
        tool = { id: "circle", center: picked };
        render();
      }

      async function pickCircleRadius(
        g: import("@design-scenes/euclid2").DistanceGizmo,
      ): Promise<void> {
        if (!tool || tool.id !== "circle" || !tool.center) return;
        const picked = await namedDistanceFromGizmo(g);
        if (typeof picked === "string") {
          error = picked;
          render();
          return;
        }
        await finishCircle(tool.center.name, picked.name);
      }

      async function pickLinePoint(h: ReturnType<typeof hit>, world: Vec2): Promise<void> {
        const picked = await resolveLinePoint(h, world);
        if (typeof picked === "string") {
          error = picked;
          render();
          return;
        }
        if (!tool || tool.id !== "line") return;
        if (!tool.a) {
          tool = { id: "line", a: picked };
          render();
          return;
        }
        if (tool.a.name === picked.name) {
          error = "Pick two different named points.";
          render();
          return;
        }
        await finishLine(tool.a.name, picked.name);
      }

      function onPointerDown(e: PointerEvent): void {
        ctx.onFocus();
        canvas.focus();
        const p = eventPos(canvas, e);
        const h = hit(e);
        if (e.button === 1 || e.altKey) {
          pan = { x: p.x, y: p.y, camX: cam.x, camY: cam.y };
          canvas.setPointerCapture(e.pointerId);
          e.preventDefault();
          return;
        }
        if (e.button !== 0) return;
        if (tool) {
          const { w, h: height } = cssSize(canvas);
          const world = screenToWorld(cam, p, w, height);
          e.preventDefault();
          if (tool.id === "point") {
            void finishPoint(snap ?? world);
            return;
          }
          if (tool.id === "circle") {
            if (!tool.center) {
              if (h?.target === "gizmo" && h.gizmo.kind === "point") {
                void pickCircleCenter(h.gizmo);
              }
              return;
            }
            if (h?.target === "gizmo" && h.gizmo.kind === "distance") {
              void pickCircleRadius(h.gizmo);
            }
            return;
          }
          if (tool.id === "line") {
            void pickLinePoint(h, world);
            return;
          }
          if (!tool.origin) {
            if (h?.target === "gizmo" && h.gizmo.kind === "point") {
              const originGizmo = h.gizmo;
              void (async () => {
                const text = await peekFile(peekCache, originGizmo.at.file);
                const name = widgetInSceneFunction(text, originGizmo.at)
                  ? (widgetBindingName(text, originGizmo.at) ?? undefined)
                  : undefined;
                tool = {
                  id: "distance",
                  origin: {
                    x: originGizmo.x,
                    y: originGizmo.y,
                    at: originGizmo.at,
                    name,
                  },
                };
                render();
              })();
              return;
            }
            tool = { id: "distance", origin: { x: world.x, y: world.y } };
            render();
            return;
          }
          void finishDistance(tool.origin, snap ?? world);
          return;
        }
        if (h?.target === "gizmo") {
          drag = {
            site: h.gizmo.site,
            start: gizmoValues(h.gizmo),
            gizmo: h.gizmo,
          };
          canvas.style.cursor = h.gizmo.kind === "number" ? "ew-resize" : "grab";
          canvas.setPointerCapture(e.pointerId);
          e.preventDefault();
          render();
          return;
        }
        if (mode === "geom" && h?.target === "geom") {
          selectedId = h.drawable.geom.id;
          selectedGeom = h.drawable.geom;
          peekCache.delete(h.drawable.geom.provenance.file);
          render();
          return;
        }
        if (mode === "geom") {
          selectedId = null;
          selectedGeom = null;
        }
        pan = { x: p.x, y: p.y, camX: cam.x, camY: cam.y };
        canvas.setPointerCapture(e.pointerId);
        render();
      }

      function onPointerMove(e: PointerEvent): void {
        const { w, h: height } = cssSize(canvas);
        const p = eventPos(canvas, e);
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
          updateSnap(e, ghost);
          render(true);
          return;
        }
        if (drag) {
          applyDrag(drag.gizmo, screenToWorld(cam, p, w, height), p, w, height, gizmos(), sceneId);
          evaluate();
          render();
          return;
        }
        const hitResult = hit(e);
        const nextId =
          mode === "geom" && hitResult?.target === "geom" ? hitResult.drawable.geom.id : null;
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
        if (!drag) return;
        const dragging = drag;
        const g = gizmos().find((x) => x.site === dragging.site);
        drag = null;
        const now = g ? gizmoValues(g) : dragging.start;
        const err = await commitGizmoIfChanged(peekCache, dragging.start, g, now);
        if (err) error = err;
        render();
      }

      function onPointerCancel(): void {
        pan = null;
        drag = null;
        render();
      }

      function onWheel(e: WheelEvent): void {
        e.preventDefault();
        const { w, h } = cssSize(canvas);
        cam = zoomAt(cam, { x: e.offsetX, y: e.offsetY }, w, h, e.deltaY < 0 ? 1.08 : 1 / 1.08);
        render(true);
      }

      canvas.addEventListener("pointerdown", onPointerDown);
      canvas.addEventListener("pointermove", onPointerMove);
      canvas.addEventListener("pointerup", onPointerUp);
      canvas.addEventListener("pointercancel", onPointerCancel);
      canvas.addEventListener("wheel", onWheel, { passive: false });
      const unobserve = observePaneResize(canvas, () => render(true));

      function rerunFrame(): void {
        clearWidgetOverrides(sceneId);
        evaluate();
        render();
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
        render();
      });

      return {
        refresh(opts) {
          if (closed) return;
          evaluate(false);
          render(opts?.quiet ?? false);
        },
        commands: () =>
          mode === "geom" ? [...EDITOR_COMMANDS, ...GEOM_CONSTRUCTOR_COMMANDS] : EDITOR_COMMANDS,
        runCommand(id) {
          if (id === "point") tool = { id: "point" };
          else if (id === "distance") tool = { id: "distance" };
          else if (mode === "geom" && id === "circle") tool = { id: "circle" };
          else if (mode === "geom" && id === "line") tool = { id: "line" };
          else return;
          ghost = null;
          snap = null;
          snapGizmo = null;
          render();
        },
        cancelCommand() {
          if (!tool) return;
          clearTool();
          render();
        },
        dispose() {
          if (closed) return;
          closed = true;
          ctx.onCommandBar?.(null);
          unsub();
          unsubHelper();
          canvas.removeEventListener("pointerdown", onPointerDown);
          canvas.removeEventListener("pointermove", onPointerMove);
          canvas.removeEventListener("pointerup", onPointerUp);
          canvas.removeEventListener("pointercancel", onPointerCancel);
          canvas.removeEventListener("wheel", onWheel);
          unobserve();
          clearWidgetOverrides(sceneId);
        },
      };
    },
  };
}

export const euclid2Host = createPaper2Host("geom");
export const sdf2Host = createPaper2Host("sdf2");
