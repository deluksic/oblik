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
import * as profile from "./scenes/profile.ts";
import {
  commitWidget,
  countEditCalls,
  peekFile,
  quantize,
  type InspectEls,
} from "./inspect.ts";

export type PaperSdf2Handle = {
  refresh: (opts?: { quiet?: boolean }) => void;
};

export type PaperSdf2Opts = {
  split?: boolean;
  canvas?: HTMLCanvasElement;
  onLiveChange?: () => void;
};

type SceneMod = {
  view: "sdf2";
  scene: () => Sdf2;
  sceneFile: string;
};

export function startPaperSdf2(
  els: InspectEls,
  opts: PaperSdf2Opts = {},
): PaperSdf2Handle {
  const canvas = opts.canvas ?? document.querySelector<HTMLCanvasElement>("#paper")!;
  canvas.hidden = false;

  const paneLabel = canvas.parentElement?.querySelector(".view-label");
  if (paneLabel) paneLabel.textContent = "SDF 2D · profile.ts";

  if (!opts.split) {
    const titleEl = document.querySelector<HTMLElement>("#scene-title")!;
    titleEl.textContent = "Sweep profile";
    document.title = "sdf2 — Sweep profile";
  }

  let sceneMod: SceneMod = profile;
  let sdf: Sdf2 | null = null;
  let gizmos: readonly Gizmo[] = [];
  let error: string | null = null;
  let cam: Camera = { x: 0.2, y: 0.32, scale: 110 };
  let hoverGizmo: Gizmo | null = null;
  let drag: { index: number; start: number[] } | null = null;
  let pan: { x: number; y: number; camX: number; camY: number } | null = null;
  const peekCache = new Map<string, string>();

  function cssSize(): { w: number; h: number } {
    const r = canvas.getBoundingClientRect();
    return { w: r.width, h: r.height };
  }

  function eventPos(e: PointerEvent): Vec2 {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function evaluate(): void {
    try {
      beginWidgetFrame("profile");
      sdf = sceneMod.scene();
      gizmos = getGizmos();
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
    publishWidgetOverrides("profile");
    opts.onLiveChange?.();
  }

  function activeGizmo(): number | null {
    return drag?.index ?? hoverGizmo?.index ?? null;
  }

  function render(quiet = false): void {
    resizeCanvas(canvas);
    const { w, h } = cssSize();
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#12141c";
    ctx.fillRect(0, 0, w, h);
    if (sdf) fillSdf2(ctx, w, h, cam, sdf);
    drawAxes(ctx, w, h, cam);
    drawGizmoOverlay(ctx, w, h, cam, gizmos, activeGizmo());
    if (quiet && !error) return;
    els.statusEl.textContent = error
      ? "Last good frame · scene threw"
      : opts.split
        ? "X = radial from each rim · Y = height. Left is the packed plan; this pane is the sweep section"
        : "Sweep profile: three circles, point + radius each, smooth-unioned. X radial, Y is Z";
    els.errorEl.hidden = !error;
    els.errorEl.textContent = error ?? "";
    if (hoverGizmo) {
      els.crumbEl.textContent = `widget ${hoverGizmo.kind} #${hoverGizmo.index} · writes ${sceneMod.sceneFile}`;
      els.metaEl.textContent =
        "Coral handles are scene widgets. The filled blob is the 2D SDF (smooth union).";
      els.sourceEl.innerHTML = `<code class="empty">Widget values are the numeric arguments of edit* in ${sceneMod.sceneFile}.</code>`;
    } else {
      els.crumbEl.textContent = "Nothing selected";
      els.metaEl.textContent = opts.split
        ? "2D writes profile.ts. Plan (left) writes cylinder.ts. Height writes rose-sdf.ts."
        : "Drag a centre or dashed radius. The three circles blend into one field.";
      els.sourceEl.innerHTML = `<code class="empty">No surface identity in this view.</code>`;
    }
  }

  function refresh(refreshOpts?: { quiet?: boolean }): void {
    evaluate();
    render(refreshOpts?.quiet ?? false);
  }

  function applyDrag(g: Gizmo, world: Vec2): void {
    if (g.kind === "point") {
      setWidgetOverride(g.index, [quantize(world.x), quantize(world.y)], "profile");
    } else if (g.kind === "distance") {
      setWidgetOverride(
        g.index,
        [quantize(Math.max(0.02, dist(world, g.origin)))],
        "profile",
      );
    }
  }

  canvas.addEventListener("pointerdown", (e) => {
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
    if (hit?.target === "gizmo") {
      drag = { index: hit.gizmo.index, start: gizmoValues(hit.gizmo) };
      canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
      render();
      return;
    }
    pan = { x: p.x, y: p.y, camX: cam.x, camY: cam.y };
    canvas.setPointerCapture(e.pointerId);
    render();
  });

  canvas.addEventListener("pointermove", (e) => {
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
    if (drag) {
      const g = gizmos.find((x) => x.index === drag?.index);
      if (g) {
        applyDrag(g, screenToWorld(cam, p, w, h));
        evaluate();
        render();
      }
      return;
    }
    const hit = hitTest(p, cam, w, h, gizmos, []);
    const next = hit?.target === "gizmo" ? hit.gizmo : null;
    if (next?.index !== hoverGizmo?.index) {
      hoverGizmo = next;
      canvas.style.cursor = next ? "grab" : "crosshair";
      render();
    }
  });

  canvas.addEventListener("pointerup", async () => {
    if (pan) {
      pan = null;
      return;
    }
    if (!drag) {
      render();
      return;
    }
    const dragging = drag;
    const g = gizmos.find((x) => x.index === dragging.index);
    drag = null;
    if (!g) {
      render();
      return;
    }
    const now = gizmoValues(g);
    const changed = now.some((v, i) => v !== dragging.start[i]);
    if (changed) {
      const err = await commitWidget(sceneMod.sceneFile, g.index, now);
      if (err) error = err;
      else peekCache.delete(`apps/paper/src/scenes/${sceneMod.sceneFile}`);
    }
    render();
  });

  canvas.addEventListener("pointercancel", () => {
    pan = null;
    drag = null;
    render();
  });

  canvas.addEventListener(
    "wheel",
    (e) => {
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
    },
    { passive: false },
  );

  window.addEventListener("resize", () => render(true));
  const pane = canvas.parentElement;
  if (pane && typeof ResizeObserver !== "undefined") {
    new ResizeObserver(() => render(true)).observe(pane);
  }

  if (import.meta.hot) {
    import.meta.hot.accept("./scenes/profile.ts", (mod) => {
      if (!mod || !("scene" in mod)) return;
      sceneMod = mod as unknown as SceneMod;
      clearWidgetOverrides("profile");
      peekCache.clear();
      void peekFile(peekCache, `apps/paper/src/scenes/${sceneMod.sceneFile}`).then(
        () => refresh(),
      );
    });
  }

  void peekFile(peekCache, `apps/paper/src/scenes/${sceneMod.sceneFile}`).then(
    () => refresh(),
  );

  return { refresh };
}

function drawAxes(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  cam: Camera,
): void {
  const ox = w / 2 + (0 - cam.x) * cam.scale;
  const oy = h / 2 - (0 - cam.y) * cam.scale;
  ctx.strokeStyle = "#3a4156";
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  ctx.moveTo(0, oy);
  ctx.lineTo(w, oy);
  ctx.moveTo(ox, 0);
  ctx.lineTo(ox, h);
  ctx.stroke();
  ctx.fillStyle = "#8b93a7";
  ctx.font = "600 11px system-ui, sans-serif";
  ctx.fillText("r", w - 18, oy - 8);
  ctx.fillText("z", ox + 8, 16);
}
