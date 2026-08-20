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
import type { PaneHandle, ViewHost } from "@design-scenes/shell";
import {
  commitWidget,
  countEditCalls,
  peekFile,
  quantize,
  renderSnippet,
} from "../inspect.ts";
import { subscribeSceneHot } from "../scene-loaders.ts";

function applyCamera3(space: SpaceView, mod: Record<string, unknown>): void {
  const c = mod.camera3;
  if (!c || typeof c !== "object") return;
  const pos = (c as { position?: unknown }).position;
  const target = (c as { target?: unknown }).target;
  if (Array.isArray(pos) && pos.length >= 3) {
    space.camera.position.set(Number(pos[0]), Number(pos[1]), Number(pos[2]));
  }
  if (Array.isArray(target) && target.length >= 3) {
    space.controls.target.set(
      Number(target[0]),
      Number(target[1]),
      Number(target[2]),
    );
  }
}

function hintOf(mod: Record<string, unknown>): string {
  return typeof mod.hint === "string"
    ? mod.hint
    : "LMB orbit · RMB pan · wheel zoom · coral glider writes this file";
}

export const euclid3Host: ViewHost = {
  mount(canvas, mod, ctx): PaneHandle {
    let sceneMod = mod as unknown as SceneModule3;
    const space = new SpaceView(canvas);
    applyCamera3(space, mod);
    const peekCache = new Map<string, string>();
    const els = ctx.inspect;

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
        const source = peekCache.get(`apps/paper/src/scenes/${ctx.sceneFile}`);
        if (source) {
          const edits = countEditCalls(source);
          if (edits > 0 && frame.gizmos.length !== edits) {
            error = `${frame.gizmos.length} widgets at runtime but ${edits} edit* calls in scene — unroll helpers`;
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

    async function updateInspect(): Promise<void> {
      if (hoverGizmo) {
        els.crumbEl.textContent = `widget ${hoverGizmo.kind} #${hoverGizmo.index} · writes ${ctx.sceneFile}`;
        els.metaEl.textContent =
          "Coral handles are scene widgets. Numbers live in the scene file and are written on pointer-up.";
        els.sourceEl.innerHTML = `<code class="empty">Widget values are the numeric arguments of edit* in ${ctx.sceneFile}.</code>`;
        return;
      }
      const g =
        frame?.drawables.find((d) => d.geom.id === (hoverId ?? selectedId))
          ?.geom ?? selectedGeom;
      if (!g) {
        els.crumbEl.textContent = "Nothing selected";
        els.metaEl.textContent = hintOf(sceneMod as unknown as Record<string, unknown>);
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
        : hintOf(sceneMod as unknown as Record<string, unknown>);
      els.errorEl.hidden = !error;
      els.errorEl.textContent = error ?? "";
      void updateInspect();
    }

    function onPointerDown(e: PointerEvent): void {
      ctx.onFocus();
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
    }

    function onPointerMove(e: PointerEvent): void {
      if (drag && frame) {
        const g = frame.gizmos.find((x) => x.index === drag?.index);
        if (g) {
          if (g.kind === "point3") {
            const p = space.dragPoint(g, e.clientX, e.clientY);
            if (p) {
              setWidgetOverride3(g.index, [
                quantize(p.x),
                quantize(p.y),
                quantize(p.z),
              ]);
            }
          } else if (g.kind === "distance3") {
            const d = space.dragDistance(g.origin, e.clientX, e.clientY);
            if (d != null) setWidgetOverride3(g.index, [quantize(d)]);
          } else {
            const t = space.dragGlider(g.a, g.b, e.clientX, e.clientY);
            if (t != null) setWidgetOverride3(g.index, [quantize(t)]);
          }
          evaluate();
          ctx.onLiveChange();
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
    }

    async function onPointerUp(): Promise<void> {
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
        const err = await commitWidget(ctx.sceneFile, g.index, now);
        if (err) error = err;
        else peekCache.delete(`apps/paper/src/scenes/${ctx.sceneFile}`);
      }
      sync();
    }

    function onPointerCancel(): void {
      space.controls.enabled = true;
      drag = null;
      sync();
    }

    const onWinResize = () => space.resize();
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerCancel);
    window.addEventListener("resize", onWinResize);
    const pane = canvas.parentElement;
    const ro =
      pane && typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => space.resize())
        : null;
    if (pane && ro) ro.observe(pane);

    const unsub = subscribeSceneHot((path, next) => {
      if (path !== `./scenes/${ctx.sceneFile}`) return;
      if (!("scene" in next)) return;
      sceneMod = next as unknown as SceneModule3;
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
