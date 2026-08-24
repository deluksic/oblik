import {
  beginWidgetFrame,
  clearImportedOverrides,
  clearWidgetOverrides,
  defaultCamera,
  drawFrame,
  drawGizmoOverlay,
  drawNumberHud,
  getGizmos,
  gizmosFromDrawables,
  gizmoValues,
  hitTest,
  numberValueFromPointer,
  publishWidgetOverrides,
  resizeCanvas,
  runScene,
  screenToWorld,
  setWidgetOverride,
  wrapAngleDeg,
  zoomAt,
  type Camera,
  type Frame,
  type Gizmo,
  type SceneModule,
} from "@design-scenes/euclid2";
import {
  beginGeomFrame,
  collectDrawables,
  dist,
  perp,
  projectT,
  type Geom,
  type Drawable,
  type Vec2,
} from "@design-scenes/geom";
import { Sdf2View, type Sdf2 } from "@design-scenes/sdf";
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

import { paletteCommands } from "./tools/catalog";
import { drawGhost, sessionGhostView } from "./tools/ghost";
import {
  commitScenePatch,
  formatWorldCursor,
  mapStack,
  pinConstructorSite,
  quantize,
  renderStackSnippets,
  stackLabel,
} from "./inspect";
import { drawInkFromStyle, inspectStylePatch, styleChannelForKind } from "./style";
import {
  advanceSessionField,
  commitSession,
  hoverSession,
  onSessionClick,
  onSessionNumber,
  sessionDraft,
  sessionDraftKind,
  sessionPreview,
  startVerb,
  withSessionDraft,
  type PickCtx,
  type ToolSession,
} from "./tools/session";
import {
  commitGizmoIfChanged,
  cssSize,
  eventPos,
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
    const worldDeg = (Math.atan2(world.y - g.origin.y, world.x - g.origin.x) * 180) / Math.PI;
    const fromDeg = (g.from * 180) / Math.PI;
    let rel = wrapAngleDeg(worldDeg - fromDeg);
    if (g.mirror) rel = wrapAngleDeg(-rel);
    setWidgetOverride(g.site, [rel], sceneId);
  } else if (g.kind === "vector") {
    setWidgetOverride(
      g.site,
      [quantize(world.x - g.origin.x), quantize(world.y - g.origin.y)],
      sceneId,
    );
  } else if (g.kind === "offset") {
    const n = perp(g.direction);
    const delta = (world.x - g.origin.x) * n.x + (world.y - g.origin.y) * n.y;
    const next = g.mirror ? g.d - delta : g.d + delta;
    setWidgetOverride(g.site, [quantize(next)], sceneId);
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
      let drag: {
        start: number[];
        gizmo: Gizmo;
        x: number;
        y: number;
        moved: boolean;
      } | null = null;
      let pan: { x: number; y: number; camX: number; camY: number } | null = null;
      let session: ToolSession | null = null;
      let lastHover: import("./tools/session").SessionHover | null = null;
      let ghost: Vec2 | null = null;
      let cursor: string | null = null;
      let selected: Selection | null = null;

      // geom-only
      let frame: Frame | null = null;
      let lastGood: Frame | null = null;
      let hoverId: string | null = null;

      // sdf2-only
      let sdf: Sdf2 | null = null;
      let sdfGizmos: readonly Gizmo[] = [];
      const sdf2View = mode === "sdf2" ? new Sdf2View(canvas) : null;

      function gizmos(): readonly Gizmo[] {
        return mode === "geom" ? (frame?.gizmos ?? []) : sdfGizmos;
      }

      function drawables(): readonly Drawable[] {
        return mode === "geom" ? (frame?.drawables ?? []) : [];
      }

      function inkOf(id: string) {
        const geom = drawables().find((d) => d.geom.id === id)?.geom;
        if (geom) return drawInkFromStyle(geom.style, styleChannelForKind(geom.kind));
        const gizmo = gizmos().find((g) => g.id === id);
        if (!gizmo) return undefined;
        const owner = drawables().find((d) => d.geom.id === gizmo.id)?.geom;
        return drawInkFromStyle(owner?.style ?? gizmo.style, styleChannelForKind(gizmo.kind));
      }

      function applyStyle(): void {
        render(true);
        void updateInspect();
      }

      function styleExtras(
        kind: string,
        current: Parameters<typeof inspectStylePatch>[0],
        at?: { file: string; line: number; column: number },
        assign?: (style: Parameters<typeof inspectStylePatch>[0] | null) => void,
      ) {
        return inspectStylePatch(current, kind, at, (style) => {
          assign?.(style);
          applyStyle();
        });
      }

      function evaluate(propagate = true): void {
        try {
          if (mode === "geom") {
            frame = runScene(sceneMod as unknown as SceneModule, sceneId);
            lastGood = frame;
          } else {
            beginGeomFrame();
            beginWidgetFrame(sceneId);
            sdf = (sceneMod as unknown as Sdf2SceneMod).scene();
            sdfGizmos = [...getGizmos(), ...gizmosFromDrawables(collectDrawables())];
          }
          error = null;
        } catch (err) {
          error = err instanceof Error ? err.message : String(err);
          if (mode === "geom") frame = lastGood;
        }
        selected = pruneSelection(
          selected,
          (frame?.drawables ?? []).map((d) => d.geom.id),
          gizmos().map((g) => g.id),
        );
        publishWidgetOverrides(sceneId);
        if (propagate) ctx.onLiveChange();
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

      function focused():
        | { target: "gizmo"; gizmo: Gizmo }
        | { target: "geom"; geom: Geom }
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
          if (mode === "sdf2") {
            showEmptyInspect(
              pushInspect,
              "Nothing selected",
              "Click a centre or radius to keep it in the sidebar. The field itself is not pickable.",
              `<code class="empty">No surface identity in this view.</code>`,
            );
            return;
          }
          showEmptyInspect(
            pushInspect,
            "Nothing selected",
            hintOf(sceneMod, "Hover or click geometry or a handle. Numbers live in the scene file."),
            `<code class="empty">Select something to see where it comes from.</code>`,
          );
          return;
        }
        if (f.target === "gizmo") {
          await showWidgetInspect(
            pushInspect,
            peekCache,
            f.gizmo,
            mode === "sdf2"
              ? "Handles are scene widgets. The filled blob is the 2D SDF."
              : "Handles are scene widgets. Numbers live in the scene file and are written on pointer-up.",
            styleExtras(
              f.gizmo.kind,
              drawables().find((d) => d.geom.id === f.gizmo.id)?.geom.style ?? f.gizmo.style,
              f.gizmo.at,
              (style) => {
                const owner = drawables().find((d) => d.geom.id === f.gizmo.id)?.geom;
                if (owner) {
                  if (style) owner.style = style;
                  else delete owner.style;
                } else if (style) f.gizmo.style = style;
                else delete f.gizmo.style;
              },
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
          ...styleExtras(g.kind, g.style, g.site, (style) => {
            if (style) g.style = style;
            else delete g.style;
          }),
        });
      }

      function statusHint(): string {
        if (mode === "sdf2") {
          return hintOf(sceneMod, "Space adds an editor · X radial, Y is Z");
        }
        return hintOf(sceneMod, "Space adds an editor · drag handles · wheel zooms");
      }

      function noteCursor(world: Vec2): void {
        cursor = formatWorldCursor(world);
      }

      function flushStatus(): void {
        setPaneStatus(
          pushInspect,
          error ? "Last good frame · scene threw" : session ? "" : statusHint(),
          error,
          cursor,
        );
      }

      function clearTool(): void {
        session = null;
        ghost = null;
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
        const draftOpen = accept || session.verb === "point";
        const state = {
          ...preview,
          numberValue: accept ? sessionDraft(session) : "",
          draftKind: sessionDraftKind(session),
          onNumber: accept
            ? (n: number) => {
                if (!session) return;
                const src = peekText(peekPath);
                if (!src) return;
                void applySessionResult(onSessionNumber(session, src, n));
              }
            : undefined,
          onCommit: accept
            ? () => {
                if (!session) return;
                const src = peekText(peekPath);
                if (!src) return;
                void applySessionResult(commitSession(session, src));
              }
            : undefined,
          onNextField: (dir: 1 | -1 = 1) => {
            if (!session) return;
            session = advanceSessionField(session, dir);
            render(true);
          },
          onNumberDraft: draftOpen
            ? (raw: string) => {
                if (!session) return;
                const trimmed = raw.trim();
                if (trimmed === "") {
                  session = withSessionDraft(session, undefined);
                  render(true);
                  return;
                }
                if (sessionDraft(session) === raw) return;
                session = withSessionDraft(session, raw);
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
        if (mode === "geom") {
          resizeCanvas(canvas);
        } else if (sdf2View) {
          sdf2View.setCamera(cam);
          if (sdf) sdf2View.setSdf(sdf);
          sdf2View.resize();
          resizeCanvas(sdf2View.overlay);
        }
        const overlay = mode === "sdf2" && sdf2View ? sdf2View.overlay : canvas;
        const { w, h } = cssSize(overlay);
        const ctx2d = overlay.getContext("2d");
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
            selectedGeomId(),
            hoverGizmoSite(),
            selectedGizmoId(),
            inkOf,
          );
        } else {
          ctx2d.clearRect(0, 0, w, h);
          drawAxes(ctx2d, w, h, cam);
          drawGizmoOverlay(ctx2d, w, h, cam, sdfGizmos, hoverGizmoSite(), selectedGizmoId(), inkOf);
        }
        if (session) {
          const view = sessionGhostView(session, lastHover, ghost);
          drawGhost(ctx2d, cam, w, h, view);
        }
        drawNumberHud(
          ctx2d,
          w,
          h,
          mode === "geom" ? (frame?.gizmos ?? []) : sdfGizmos,
          hoverGizmoSite(),
          selectedGizmoId(),
        );
        if (quiet && !error) {
          if (session) syncCommandBar();
          flushStatus();
          return;
        }
        flushStatus();
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
        const src = sceneSrc ?? peekText(peekPath);
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
        for (const d of drawables()) {
          const g = d.geom;
          if (g.kind !== "point" || !g.site) continue;
          if (!Number.isFinite(g.x) || !Number.isFinite(g.y)) continue;
          const cached = peekText(g.site.file) ?? src;
          if (!cached || !widgetInSceneFunction(cached, g.site)) continue;
          const name = widgetBindingName(cached, g.site);
          if (name) add(name, g.x, g.y);
        }
        if (src) {
          const offsetEvals = sceneOffsetEvals();
          for (const d of evalDerivedScenePoints(src, out, offsetEvals)) add(d.name, d.x, d.y);
        }
        return out;
      }

      function updateSnap(e: PointerEvent, world: Vec2): void {
        lastHover = null;
        if (!session) return;
        const c = pickCtxFor(e, world);
        if (!c) return;
        const hover = hoverSession(session, c);
        lastHover = hover;
        if (hover.hoverId) {
          hoverId = hover.hoverId;
        } else if (session.verb === "distance" && !session.from) {
          hoverId = null;
        }
        hoverGizmo = c.hit?.target === "gizmo" ? c.hit.gizmo : null;
        if (c.hit?.target === "geom" && c.hit.drawable.geom.kind === "point") {
          hoverId = c.hit.drawable.geom.id;
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
            start: gizmoValues(h.gizmo),
            gizmo: h.gizmo,
            x: p.x,
            y: p.y,
            moved: false,
          };
          canvas.style.cursor = h.gizmo.kind === "number" ? "ew-resize" : "grab";
          canvas.setPointerCapture(e.pointerId);
          e.preventDefault();
          render();
          return;
        }
        if (mode === "geom" && h?.target === "geom") {
          selected = { target: "geom", id: h.drawable.geom.id };
          peekCache.delete(h.drawable.geom.provenance.file);
          render();
          return;
        }
        selected = null;
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
          noteCursor(screenToWorld(cam, p, w, height));
          render(true);
          return;
        }
        const world = screenToWorld(cam, p, w, height);
        noteCursor(world);
        if (session) {
          ghost = world;
          updateSnap(e, ghost);
          render(true);
          return;
        }
        if (drag) {
          if (!drag.moved) {
            if (!movedPastClick(drag.x, drag.y, p.x, p.y)) {
              flushStatus();
              return;
            }
            drag.moved = true;
          }
          applyDrag(drag.gizmo, world, p, w, height, gizmos(), sceneId);
          evaluate();
          render();
          return;
        }
        const hitResult = hit(e);
        const nextId =
          mode === "geom" && hitResult?.target === "geom" ? hitResult.drawable.geom.id : null;
        const nextG = hitResult?.target === "gizmo" ? hitResult.gizmo : null;
        if (nextId !== hoverId || nextG?.id !== hoverGizmo?.id) {
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
          return;
        }
        flushStatus();
      }

      function onPointerLeave(): void {
        if (pan || drag) return;
        cursor = null;
        if (hoverGizmo || hoverId) {
          hoverGizmo = null;
          hoverId = null;
          render();
          return;
        }
        flushStatus();
      }

      async function onPointerUp(): Promise<void> {
        if (pan) {
          pan = null;
          return;
        }
        if (!drag) return;
        const dragging = drag;
        drag = null;
        if (!dragging.moved) {
          selected = { target: "gizmo", id: dragging.gizmo.id };
          render();
          return;
        }
        const g = gizmos().find((x) => x.id === dragging.gizmo.id);
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
        noteCursor(screenToWorld(cam, { x: e.offsetX, y: e.offsetY }, w, h));
        render(true);
      }

      canvas.addEventListener("pointerdown", onPointerDown);
      canvas.addEventListener("pointermove", onPointerMove);
      canvas.addEventListener("pointerleave", onPointerLeave);
      canvas.addEventListener("pointerup", onPointerUp);
      canvas.addEventListener("pointercancel", onPointerCancel);
      canvas.addEventListener("wheel", onWheel, { passive: false });
      const unobserve = observePaneResize(canvas, () => {
        sdf2View?.resize();
        render(true);
      });

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
        commands: () => paletteCommands(mode),
        runCommand(id) {
          const next = startVerb(id);
          if (!next) return;
          session = next;
          ghost = null;
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
          canvas.removeEventListener("pointerleave", onPointerLeave);
          canvas.removeEventListener("pointerup", onPointerUp);
          canvas.removeEventListener("pointercancel", onPointerCancel);
          canvas.removeEventListener("wheel", onWheel);
          unobserve();
          sdf2View?.dispose();
          clearWidgetOverrides(sceneId);
        },
      };
    },
  };
}

export const euclid2Host = createPaper2Host("geom");
export const sdf2Host = createPaper2Host("sdf2");
