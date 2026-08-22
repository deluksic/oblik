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
  perp,
  projectT,
  type Geom,
  type Drawable,
  type Vec2,
} from "@design-scenes/geom";
import { fillSdf2, type Sdf2 } from "@design-scenes/sdf";
import type { PaneHandle, ViewHost } from "@design-scenes/shell";
import {
  commandBarSnapshotKey,
  evalDerivedScenePoints,
  inspectSnapshotKey,
  subscribeHelperHot,
  subscribeSceneHot,
  widgetBindingName,
  widgetInSceneFunction,
} from "@design-scenes/shell";

import {
  drawEditorGhost,
  EDITOR_COMMANDS,
  LINE_COMMAND,
  type GhostSnap,
} from "./editors";
import { commitScenePatch, peekFile, quantize, renderSnippet } from "./inspect";
import {
  sessionPreview,
  hoverSession,
  onSessionClick,
  onSessionNumber,
  sessionAsGhostTool,
  startVerb,
  type PickCtx,
  type ToolSession,
} from "./tools/session";
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
  } else if (g.kind === "offset") {
    const n = perp(g.direction);
    const signed = (world.x - g.origin.x) * n.x + (world.y - g.origin.y) * n.y;
    setWidgetOverride(g.site, [quantize(signed)], sceneId);
  } else if (g.kind === "number") {
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
      let session: ToolSession | null = null;
      let lastHover: import("./tools/session").SessionHover | null = null;
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
        session = null;
        ghost = null;
        snap = null;
        snapGizmo = null;
        lastHover = null;
        ctx.onCommandBar?.(null);
      }

      function pickCtxFor(e: PointerEvent, world: Vec2): PickCtx | null {
        const src = peekText(peekPath);
        if (!src) return null;
        const { w, h } = cssSize(canvas);
        return {
          hit: hit(e),
          world,
          screen: eventPos(canvas, e),
          cam,
          w,
          h,
          drawables: drawables(),
          gizmos: gizmos(),
          sceneSrc: src,
          sceneFile: ctx.sceneFile,
          namedPoints: scenePointEvals(),
        };
      }

      async function applySessionResult(
        result: import("./tools/session").SessionResult,
      ): Promise<void> {
        if (result.kind === "session") {
          session = result.session;
          render();
          return;
        }
        if (result.kind === "error") {
          error = result.message;
          render();
          return;
        }
        const err = await commitScenePatch(ctx.sceneFile, result.patch);
        clearTool();
        if (err) error = err;
        else peekCache.delete(peekPath);
        evaluate();
        render();
      }

      function syncCommandBar(): void {
        if (!ctx.onCommandBar) return;
        if (!session) {
          if (lastBarKey !== "") {
            lastBarKey = "";
            ctx.onCommandBar(null);
          }
          return;
        }
        const preview = sessionPreview(session);
        if (!preview) {
          if (lastBarKey !== "") {
            lastBarKey = "";
            ctx.onCommandBar(null);
          }
          return;
        }
        const accept = Boolean(preview.acceptNumber);
        const state = {
          ...preview,
          numberValue: session.verb === "distance" ? (session.typed ?? "") : "",
          onNumber: accept
            ? (n: number) => {
                if (!session) return;
                const src = peekText(peekPath);
                if (!src) return;
                void applySessionResult(onSessionNumber(session, src, n));
              }
            : undefined,
          onNumberDraft: accept
            ? (raw: string) => {
                if (!session || session.verb !== "distance") return;
                const trimmed = raw.trim();
                if (trimmed === "") {
                  session = { ...session, typed: undefined };
                  render(true);
                  return;
                }
                if (session.typed === raw) return;
                session = { ...session, typed: raw };
                render(true);
              }
            : undefined,
        };
        const key = commandBarSnapshotKey(state);
        if (key === lastBarKey) return;
        lastBarKey = key;
        ctx.onCommandBar(state);
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
        if (session) {
          const ghostTool = sessionAsGhostTool(session, lastHover);
          drawEditorGhost(
            ctx2d,
            cam,
            w,
            h,
            ghostTool,
            ghost,
            snap,
            lastHover?.ghost === "parallel" && session.verb === "distance" && !session.from,
          );
        }
        if (quiet && !error) {
          if (session?.verb === "distance" && session.from) {
            syncCommandBar();
          }
          return;
        }
        setPaneStatus(
          pushInspect,
          error ? "Last good frame · scene threw" : sessionPreview(session)?.hint ?? statusHint(),
          error,
        );
        if (session) syncCommandBar();
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

      function sceneOffsetEvals(): Map<string, number> {
        const out = new Map<string, number>();
        for (const g of gizmos()) {
          if (g.kind !== "offset") continue;
          const cached = peekText(g.at.file);
          if (!cached || !widgetInSceneFunction(cached, g.at)) continue;
          const name = widgetBindingName(cached, g.at);
          if (name) out.set(name, g.d);
        }
        return out;
      }

      function scenePointEvals(sceneSrc?: string): { name: string; x: number; y: number }[] {
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
        const src = sceneSrc ?? peekText(peekPath);
        if (src) {
          const offsetEvals = sceneOffsetEvals();
          for (const d of evalDerivedScenePoints(src, out, offsetEvals)) add(d.name, d.x, d.y);
        }
        return out;
      }

      function updateSnap(e: PointerEvent, world: Vec2): void {
        snap = null;
        snapGizmo = null;
        lastHover = null;
        if (!session) return;
        const c = pickCtxFor(e, world);
        if (!c) return;
        const hover = hoverSession(session, c);
        lastHover = hover;
        if (hover.snap) {
          snap = {
            kind: hover.snap.kind,
            x: hover.snap.x,
            y: hover.snap.y,
            d: hover.snap.d,
          };
        }
        if (hover.ghost === "parallel" && c.hit?.target === "geom") {
          const k = c.hit.drawable.geom.kind;
          if (k === "segment" || k === "line") hoverId = c.hit.drawable.geom.id;
        } else if (session.verb === "distance" && !session.from) {
          hoverId = null;
        }
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
        if (session) {
          const { w, h: height } = cssSize(canvas);
          const world = screenToWorld(cam, p, w, height);
          e.preventDefault();
          const c = pickCtxFor(e, world);
          if (!c) {
            error = "Could not read scene().";
            render();
            return;
          }
          void applySessionResult(onSessionClick(session, c, c.sceneSrc));
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
        if (session) {
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
        commands: () => (mode === "geom" ? [...EDITOR_COMMANDS, LINE_COMMAND] : EDITOR_COMMANDS),
        runCommand(id) {
          const next = startVerb(id);
          if (!next) return;
          session = next;
          ghost = null;
          snap = null;
          snapGizmo = null;
          lastHover = null;
          render();
        },
        cancelCommand() {
          if (!session) return;
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
