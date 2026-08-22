import type { Camera, Gizmo, Hit } from "@design-scenes/euclid2";
import { hitsNear } from "@design-scenes/euclid2";
import {
  add,
  circleLineIntersection,
  dist,
  distToLine,
  dot,
  line,
  lineIntersection,
  perp,
  sub,
  type Circle,
  type Drawable,
  type GeomSite,
  type LineLike,
  type Vec2,
} from "@design-scenes/geom";
import {
  bindLineAt,
  editCallArgText,
  nextBindingName,
  widgetBindingName,
  widgetCallName,
  widgetInSceneFunction,
  type ScenePatch,
  type SourceAt,
} from "@design-scenes/shell";

import type { CommandPreview, EditorTool } from "../editors";

export type LineBind =
  | { kind: "named"; name: string; field?: "line" }
  | { kind: "site"; site: SourceAt; field?: "line" }
  | { kind: "expr"; expr: string };

export type PointBind =
  | { kind: "named"; name: string; x: number; y: number }
  | { kind: "free"; x: number; y: number }
  | { kind: "intersection"; a: LineBind; b: LineBind; x: number; y: number }
  | {
      kind: "circleLine";
      circle: string;
      line: LineBind;
      k: 1 | -1;
      x: number;
      y: number;
    };

export type FromBind =
  | { kind: "point"; point: PointBind }
  | { kind: "line"; line: LineBind; origin: Vec2; dir: Vec2 };

export type LengthBind =
  | { kind: "fresh"; value: number }
  | { kind: "reuse"; name: string; negate?: boolean }
  | { kind: "field"; object: string; field: "radius" | "distance"; negate?: boolean }
  | { kind: "dist"; other: PointBind }
  | { kind: "signedDist"; other: PointBind };

export type ToolSession =
  | { verb: "point" }
  | { verb: "line"; a?: PointBind }
  | { verb: "segment"; a?: PointBind }
  | { verb: "slider"; typed?: string }
  | {
      verb: "circle";
      center?: PointBind;
      lengthReuse?: { name: string; signed: boolean };
      typed?: string;
    }
  | {
      verb: "offset";
      from?: FromBind;
      lengthReuse?: { name: string; signed: boolean };
      typed?: string;
    }
  | {
      verb: "distance";
      from?: FromBind;
      lengthReuse?: { name: string; signed: boolean };
      typed?: string;
    };

export type PickCtx = {
  hit: Hit | null;
  world: Vec2;
  screen: Vec2;
  cam: Camera;
  w: number;
  h: number;
  drawables: readonly Drawable[];
  gizmos: readonly Gizmo[];
  sceneSrc: string;
  sceneFile: string;
  namedPoints: { name: string; x: number; y: number }[];
};

export type SessionHover = {
  snap: { kind: "point" | "intersection" | "distance"; x: number; y: number; d?: number } | null;
  ghost: "point" | "ring" | "parallel" | "none";
  lineBasis?: { origin: Vec2; dir: Vec2 };
  hoverId: string | null;
  hoverGizmoSite?: string | null;
};

export type SessionResult =
  | { kind: "session"; session: ToolSession; status?: string }
  | { kind: "commit"; patch: ScenePatch }
  | { kind: "error"; message: string };

function escapeHtml(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function slotHtml(label: string, extraClass = ""): string {
  const cls = extraClass ? `slot ${extraClass}` : "slot";
  const attr = extraClass.includes("is-number") ? ` data-placeholder="${escapeHtml(label)}"` : "";
  return `<span class="${cls}"${attr}>${escapeHtml(label)}</span>`;
}

function arg(content: string, state: "active" | "done" | "pending"): string {
  return `<span class="arg arg-${state}">${content}</span>`;
}

function slot(label: string, extraClass = "", state: "active" | "pending" | "done" = "active"): string {
  return arg(slotHtml(label, extraClass), state);
}

function filled(text: string): string {
  return arg(escapeHtml(text), "done");
}

function fn(name: string, args: string[]): string {
  const body = args
    .map((html, i) => (i === 0 ? html : `<span class="cmd-punct">, </span>${html}`))
    .join("");
  return `<span class="cmd-name">${escapeHtml(name)}</span><span class="cmd-punct">(</span>${body}<span class="cmd-punct">)</span>`;
}

function fmt(n: number): string {
  const q = Math.round(n * 100) / 100;
  if (Object.is(q, -0)) return "0";
  return String(q);
}

function siteAt(site: GeomSite | undefined, sceneFile: string): SourceAt | null {
  if (!site) return null;
  const scene = sceneFile.replace(/\\/g, "/");
  const file = site.file.replace(/\\/g, "/");
  const base = scene.split("/").pop() ?? scene;
  if (!file.endsWith(base) && file !== scene) return null;
  return { line: site.line, column: site.column };
}

function pickRadius(ctx: PickCtx): number {
  return Math.max(0.12, 12 / ctx.cam.scale);
}

function namedPointNear(
  pts: { name: string; x: number; y: number }[],
  world: Vec2,
  max = 0.35,
): PointBind | null {
  let best: PointBind | null = null;
  let bestD = max;
  for (const p of pts) {
    const d = Math.hypot(p.x - world.x, p.y - world.y);
    if (d <= bestD) {
      bestD = d;
      best = { kind: "named", name: p.name, x: p.x, y: p.y };
    }
  }
  return best;
}

function worldOriginNear(ctx: PickCtx): PointBind | null {
  const max = pickRadius(ctx);
  if (Math.hypot(ctx.world.x, ctx.world.y) > max) return null;
  const named = namedPointNear(ctx.namedPoints, { x: 0, y: 0 }, max);
  if (named) return named;
  return { kind: "free", x: 0, y: 0 };
}

function pointFromGeom(ctx: PickCtx): PointBind | null {
  if (ctx.hit?.target !== "geom" || ctx.hit.drawable.geom.kind !== "point") return null;
  const g = ctx.hit.drawable.geom;
  const named = namedPointNear(ctx.namedPoints, g, pickRadius(ctx));
  if (named) return named;
  return { kind: "free", x: g.x, y: g.y };
}

function gizmoInScene(src: string, g: Gizmo): boolean {
  return widgetInSceneFunction(src, { line: g.at.line, column: g.at.column });
}

function gizmoName(src: string, g: Gizmo): string | null {
  if (!gizmoInScene(src, g)) return null;
  return widgetBindingName(src, { line: g.at.line, column: g.at.column });
}

function lineWithSite(
  d: Drawable,
  sceneFile: string,
  src: string,
): { bind: LineBind; line: LineLike; id: string } | null {
  const g = d.geom;
  if (g.kind !== "segment" && g.kind !== "line") return null;
  const site = siteAt(g.site, sceneFile);
  if (!site) return null;
  const field = g.kind === "line" && g.offsetDistance != null ? ("line" as const) : undefined;
  const name = widgetBindingName(src, site);
  const bind: LineBind = name
    ? { kind: "named", name, field }
    : { kind: "site", site, field };
  return { bind, line: g, id: g.id };
}

function offsetAsLine(
  src: string,
  g: Extract<Gizmo, { kind: "offset" }>,
): { bind: LineBind; line: LineLike; id: string } | null {
  const name = gizmoName(src, g);
  if (!name) return null;
  const at = { line: g.at.line, column: g.at.column };
  const callee = widgetCallName(src, at);
  const basis = line(g.origin, add(g.origin, g.direction));
  if (callee === "offsetLine") {
    return { bind: { kind: "named", name, field: "line" }, line: basis, id: g.site };
  }
  const base = editCallArgText(src, at, 0);
  if (!base) return null;
  return {
    bind: { kind: "expr", expr: `offsetLine(${base}, ${name}).line` },
    line: basis,
    id: g.site,
  };
}

function lineOriginDir(ll: LineLike): { origin: Vec2; dir: Vec2 } {
  if (ll.kind === "line") return { origin: ll.origin, dir: ll.direction };
  const dir = sub(ll.b, ll.a);
  const len = Math.hypot(dir.x, dir.y) || 1;
  return { origin: ll.a, dir: { x: dir.x / len, y: dir.y / len } };
}

export function lineLikesNear(ctx: PickCtx): { bind: LineBind; line: LineLike; id: string }[] {
  const out: { bind: LineBind; line: LineLike; id: string }[] = [];
  const seen = new Set<string>();
  const push = (hit: { bind: LineBind; line: LineLike; id: string } | null) => {
    if (!hit || seen.has(hit.id)) return;
    seen.add(hit.id);
    out.push(hit);
  };
  for (const d of hitsNear(ctx.screen, ctx.cam, ctx.w, ctx.h, ctx.drawables)) {
    push(lineWithSite(d, ctx.sceneFile, ctx.sceneSrc));
  }
  const maxW = 8 / ctx.cam.scale;
  for (const g of ctx.gizmos) {
    if (g.kind !== "offset") continue;
    if (distToLine(ctx.world, g.origin, g.direction) > maxW) continue;
    push(offsetAsLine(ctx.sceneSrc, g));
  }
  return out;
}

function allSceneLineLikes(ctx: PickCtx): { bind: LineBind; line: LineLike; id: string }[] {
  const out: { bind: LineBind; line: LineLike; id: string }[] = [];
  const seen = new Set<string>();
  const push = (hit: { bind: LineBind; line: LineLike; id: string } | null) => {
    if (!hit || seen.has(hit.id)) return;
    seen.add(hit.id);
    out.push(hit);
  };
  for (const d of ctx.drawables) {
    push(lineWithSite(d, ctx.sceneFile, ctx.sceneSrc));
  }
  for (const g of ctx.gizmos) {
    if (g.kind === "offset") push(offsetAsLine(ctx.sceneSrc, g));
  }
  return out;
}

function namedCircles(ctx: PickCtx): { name: string; circle: Circle }[] {
  const out: { name: string; circle: Circle }[] = [];
  for (const d of ctx.drawables) {
    if (d.geom.kind !== "circle") continue;
    const site = siteAt(d.geom.site, ctx.sceneFile);
    if (!site) continue;
    const name = widgetBindingName(ctx.sceneSrc, site);
    if (!name) continue;
    out.push({ name, circle: d.geom });
  }
  return out;
}

function resolveLineLineCrossing(ctx: PickCtx): PointBind | null {
  const likes = lineLikesNear(ctx);
  if (likes.length < 2) return null;
  for (let i = 0; i < likes.length - 1; i++) {
    for (let j = i + 1; j < likes.length; j++) {
      const a = likes[i]!;
      const b = likes[j]!;
      const pt = lineIntersection(a.line, b.line);
      if (!Number.isFinite(pt.x) || !Number.isFinite(pt.y)) continue;
      if (Math.hypot(pt.x - ctx.world.x, pt.y - ctx.world.y) > 0.35) continue;
      return { kind: "intersection", a: a.bind, b: b.bind, x: pt.x, y: pt.y };
    }
  }
  return null;
}

function resolveCircleLineCrossing(ctx: PickCtx): PointBind | null {
  const likes = allSceneLineLikes(ctx);
  if (likes.length === 0) return null;
  const circs = namedCircles(ctx);
  if (circs.length === 0) return null;
  let best: PointBind | null = null;
  let bestD = 0.35;
  for (const c of circs) {
    for (const ll of likes) {
      for (const k of [1, -1] as const) {
        const pt = circleLineIntersection(c.circle, ll.line, k);
        if (!Number.isFinite(pt.x) || !Number.isFinite(pt.y)) continue;
        const d = Math.hypot(pt.x - ctx.world.x, pt.y - ctx.world.y);
        if (d <= bestD) {
          bestD = d;
          best = { kind: "circleLine", circle: c.name, line: ll.bind, k, x: pt.x, y: pt.y };
        }
      }
    }
  }
  return best;
}

export function resolveCrossing(ctx: PickCtx): PointBind | null {
  const cl = resolveCircleLineCrossing(ctx);
  const ll = resolveLineLineCrossing(ctx);
  if (cl && ll) {
    const dCl = Math.hypot(cl.x - ctx.world.x, cl.y - ctx.world.y);
    const dLl = Math.hypot(ll.x - ctx.world.x, ll.y - ctx.world.y);
    return dCl <= dLl ? cl : ll;
  }
  return cl ?? ll;
}

function pointFromGizmo(ctx: PickCtx): PointBind | null {
  if (ctx.hit?.target !== "gizmo") return null;
  const g = ctx.hit.gizmo;
  if (g.kind !== "point" && g.kind !== "glider" && g.kind !== "lineGlider") return null;
  const pos =
    g.kind === "point"
      ? { x: g.x, y: g.y }
      : g.kind === "glider"
        ? { x: g.a.x + (g.b.x - g.a.x) * g.t, y: g.a.y + (g.b.y - g.a.y) * g.t }
        : add(g.origin, { x: g.direction.x * g.s, y: g.direction.y * g.s });
  const named = namedPointNear(ctx.namedPoints, pos, pickRadius(ctx));
  if (named) return named;
  const name = gizmoName(ctx.sceneSrc, g);
  if (name) return { kind: "named", name, x: pos.x, y: pos.y };
  return { kind: "free", x: pos.x, y: pos.y };
}

export function resolvePoint(ctx: PickCtx): PointBind | "ignore" {
  const namedGizmo = pointFromGizmo(ctx);
  if (namedGizmo) return namedGizmo;
  const geomPt = pointFromGeom(ctx);
  if (geomPt) return geomPt;
  const crossing = resolveCrossing(ctx);
  if (crossing) return crossing;
  if (ctx.hit?.target === "gizmo") {
    const k = ctx.hit.gizmo.kind;
    if (k === "distance" || k === "offset" || k === "number" || k === "angle") return "ignore";
  }
  if (ctx.hit?.target === "geom" && ctx.hit.drawable.geom.kind === "circle") return "ignore";
  const named = namedPointNear(ctx.namedPoints, ctx.world, pickRadius(ctx));
  if (named) return named;
  const origin = worldOriginNear(ctx);
  if (origin) return origin;
  return { kind: "free", x: ctx.world.x, y: ctx.world.y };
}

export type DistanceFromHit =
  | { kind: "point"; point: PointBind }
  | { kind: "line"; line: LineBind; origin: Vec2; dir: Vec2 }
  | { kind: "earlyLength"; name: string }
  | { kind: "empty" }
  | { kind: "ignore" }
  | { kind: "noSite" };

export function resolveDistanceFrom(ctx: PickCtx): DistanceFromHit {
  if (ctx.hit?.target === "gizmo" && ctx.hit.gizmo.kind === "point") {
    const named = pointFromGizmo(ctx);
    if (named) return { kind: "point", point: named };
  }
  const geomPt = pointFromGeom(ctx);
  if (geomPt) return { kind: "point", point: geomPt };
  const crossing = resolveCrossing(ctx);
  if (crossing) return { kind: "point", point: crossing };

  if (ctx.hit?.target === "gizmo" && ctx.hit.gizmo.kind === "distance") {
    const name = gizmoName(ctx.sceneSrc, ctx.hit.gizmo);
    if (name) return { kind: "earlyLength", name };
    return { kind: "ignore" };
  }

  if (ctx.hit?.target === "gizmo" && ctx.hit.gizmo.kind === "offset") {
    const off = offsetAsLine(ctx.sceneSrc, ctx.hit.gizmo);
    if (!off) return { kind: "ignore" };
    const od = lineOriginDir(off.line);
    return { kind: "line", line: off.bind, origin: od.origin, dir: od.dir };
  }

  if (ctx.hit?.target === "geom") {
    const g = ctx.hit.drawable.geom;
    if (g.kind === "segment" || g.kind === "line") {
      if (!siteAt(g.site, ctx.sceneFile)) return { kind: "noSite" };
    }
  }

  if (ctx.hit?.target === "gizmo" && ctx.hit.gizmo.kind === "number") return { kind: "ignore" };
  if (ctx.hit?.target === "geom" && ctx.hit.drawable.geom.kind === "circle") return { kind: "ignore" };

  const likes = lineLikesNear(ctx);
  if (likes.length === 1) {
    const hit = likes[0]!;
    const od = lineOriginDir(hit.line);
    return { kind: "line", line: hit.bind, origin: od.origin, dir: od.dir };
  }

  const named = namedPointNear(ctx.namedPoints, ctx.world, pickRadius(ctx));
  if (named) return { kind: "point", point: named };
  const origin = worldOriginNear(ctx);
  if (origin) return { kind: "point", point: origin };
  return { kind: "empty" };
}

function lengthFromGizmo(ctx: PickCtx, g: Gizmo): LengthBind | "ignore" {
  const name = gizmoName(ctx.sceneSrc, g);
  if (!name) return "ignore";
  if (g.kind === "number") return { kind: "reuse", name };
  if (g.kind === "offset") return { kind: "field", object: name, field: "distance" };
  if (g.kind === "distance") {
    const circ = ctx.drawables.find(
      (d) =>
        d.geom.kind === "circle" &&
        d.geom.site &&
        `${d.geom.site.file}:${d.geom.site.line}:${d.geom.site.column}` === g.site,
    );
    if (circ) return { kind: "field", object: name, field: "radius" };
    return { kind: "reuse", name };
  }
  return "ignore";
}

export function resolveLength(ctx: PickCtx, mode: "circle" | "offset" | "distance" = "distance"): LengthBind | "ignore" | "measure" {
  if (ctx.hit?.target === "gizmo") {
    const g = ctx.hit.gizmo;
    if (g.kind === "distance" || g.kind === "offset" || g.kind === "number") {
      return lengthFromGizmo(ctx, g);
    }
    if (g.kind === "point" || g.kind === "glider" || g.kind === "lineGlider") {
      const p = pointFromGizmo(ctx);
      if (!p) return "ignore";
      return mode === "offset" ? { kind: "signedDist", other: p } : { kind: "dist", other: p };
    }
    return "ignore";
  }
  if (ctx.hit?.target === "geom") {
    const g = ctx.hit.drawable.geom;
    if (g.kind === "circle") {
      const site = siteAt(g.site, ctx.sceneFile);
      const name = site ? widgetBindingName(ctx.sceneSrc, site) : null;
      if (name) return { kind: "field", object: name, field: "radius" };
      return "ignore";
    }
    if (g.kind === "line" && g.offsetDistance != null) {
      const site = siteAt(g.site, ctx.sceneFile);
      const name = site ? widgetBindingName(ctx.sceneSrc, site) : null;
      if (name) return { kind: "field", object: name, field: "distance" };
      return "ignore";
    }
    const geomPt = pointFromGeom(ctx);
    if (geomPt) {
      return mode === "offset" ? { kind: "signedDist", other: geomPt } : { kind: "dist", other: geomPt };
    }
    return "ignore";
  }
  const named = namedPointNear(ctx.namedPoints, ctx.world, pickRadius(ctx));
  if (named) {
    return mode === "offset" ? { kind: "signedDist", other: named } : { kind: "dist", other: named };
  }
  return "measure";
}

export function sessionAsGhostTool(session: ToolSession, _hover: SessionHover | null): EditorTool {
  if (session.verb === "point") return { id: "point" };
  if (session.verb === "slider") return { id: "point" };
  if (session.verb === "line" || session.verb === "segment") {
    if (!session.a) return { id: "point" };
    const p = session.a;
    return {
      id: session.verb === "line" ? "infiniteLine" : "segment",
      a: {
        x: p.x,
        y: p.y,
        ...(p.kind === "named" ? { name: p.name } : {}),
      },
    };
  }
  if (session.verb === "circle") {
    if (!session.center) return { id: "point" };
    const p = session.center;
    return {
      id: "circle",
      center: {
        x: p.x,
        y: p.y,
        ...(p.kind === "named" ? { name: p.name } : {}),
      },
      typedRadius: session.typed,
    };
  }
  if (session.verb === "offset" && session.from?.kind === "line") {
    return {
      id: "offset",
      baseLine: { origin: session.from.origin, dir: session.from.dir },
      typedDistance: session.typed,
    };
  }
  if (session.verb === "offset") return { id: "point" };
  if (session.from?.kind === "point") {
    const p = session.from.point;
    return {
      id: "distance",
      origin: {
        x: p.x,
        y: p.y,
        name: p.kind === "named" ? p.name : undefined,
      },
      typedRadius: session.typed,
    };
  }
  if (session.from?.kind === "line") {
    const basis = { origin: session.from.origin, dir: session.from.dir };
    return {
      id: "offset",
      base: "line",
      baseLine: basis,
      typedDistance: session.typed,
    };
  }
  return { id: "distance", typedRadius: session.typed };
}

export function startVerb(id: string): ToolSession | null {
  if (id === "point") return { verb: "point" };
  if (id === "distance") return { verb: "distance" };
  if (id === "line") return { verb: "line" };
  if (id === "segment") return { verb: "segment" };
  if (id === "circle") return { verb: "circle" };
  if (id === "offset") return { verb: "offset" };
  if (id === "slider") return { verb: "slider" };
  return null;
}

function pointLabel(p: PointBind | undefined, slotName: string, filledIf: boolean): string {
  if (!p) return slot(slotName, "", filledIf ? "pending" : "active");
  if (p.kind === "named") return filled(p.name);
  if (p.kind === "intersection") return filled("lineIntersection");
  if (p.kind === "circleLine") return filled("circleLineIntersection");
  return slot(slotName, "", "done");
}

export function sessionPreview(session: ToolSession | null): CommandPreview | null {
  if (!session) return null;
  if (session.verb === "point") {
    return {
      previewHtml: fn("point", [slot("<x>"), slot("<y>")]),
      hint: "Click empty paper or a line crossing.",
    };
  }
  if (session.verb === "slider") {
    return {
      previewHtml: fn("slider", [slot(session.typed?.trim() ? session.typed : "<n>", "is-number")]),
      acceptNumber: true,
      hint: "Type a value and Enter, or click to measure.",
    };
  }
  if (session.verb === "line" || session.verb === "segment") {
    const a = pointLabel(session.a, "<a>", false);
    const b = slot("<b>", "", session.a ? "active" : "pending");
    const name = session.verb === "line" ? "line" : "segment";
    return {
      previewHtml: fn(name, [a, b]),
      hint: session.a ? "Click the second point." : "Click the first point.",
    };
  }
  const dSlot = session.lengthReuse
    ? filled(session.lengthReuse.name)
    : slot(
        session.typed?.trim() ? session.typed : "<d>",
        session.verb === "circle" ? (session.center ? "is-number" : "") : session.from ? "is-number" : "",
        session.verb === "circle" ? (session.center ? "active" : "pending") : session.from ? "active" : "pending",
      );
  if (session.verb === "circle") {
    return {
      previewHtml: fn("circle", [pointLabel(session.center, "<center>", false), dSlot]),
      acceptNumber: !!session.center && !session.lengthReuse,
      hint: session.center
        ? "Type a radius, click empty, a length, or a point."
        : "Click the center.",
    };
  }
  if (session.verb === "offset") {
    if (!session.from || session.from.kind !== "line") {
      return {
        previewHtml: fn("offsetLine", [slot("<line>"), dSlot]),
        hint: "Click a scene line or offset.",
      };
    }
    const lineLabel =
      session.from.line.kind === "named"
        ? filled(
            session.from.line.field === "line"
              ? `${session.from.line.name}.line`
              : session.from.line.name,
          )
        : session.from.line.kind === "expr"
          ? filled("offsetLine")
          : slot("<line>", "", "done");
    return {
      previewHtml: fn("offsetLine", [lineLabel, dSlot]),
      acceptNumber: !session.lengthReuse,
      hint: "Type a distance, click a side, a length, or a point.",
    };
  }
  if (!session.from) {
    return {
      previewHtml: fn("distance", [slot("<from>"), dSlot]),
      hint: "Click a point, a crossing, a scene line, or an offset handle.",
    };
  }
  if (session.from.kind === "point") {
    return {
      previewHtml: fn("editDistanceToPoint", [pointLabel(session.from.point, "<point>", true), dSlot]),
      acceptNumber: !session.lengthReuse,
      hint: "Type a radius and Enter, click to measure, or reuse a dashed ring.",
    };
  }
  const lineLabel =
    session.from.line.kind === "named"
      ? filled(session.from.line.name)
      : session.from.line.kind === "expr"
        ? filled("offsetLine")
        : slot("<line>", "", "done");
  return {
    previewHtml: fn("editOffsetFromLine", [lineLabel, dSlot]),
    acceptNumber: !session.lengthReuse,
    hint: "Type a distance, click a side, or reuse a numeric widget.",
  };
}

export function hoverSession(session: ToolSession, ctx: PickCtx): SessionHover {
  if (
    session.verb === "point" ||
    session.verb === "line" ||
    session.verb === "segment" ||
    session.verb === "slider" ||
    (session.verb === "circle" && !session.center)
  ) {
    if (session.verb === "slider") {
      return { snap: { kind: "point", x: ctx.world.x, y: ctx.world.y }, ghost: "none", hoverId: null };
    }
    const p = resolvePoint(ctx);
    if (p === "ignore") return { snap: null, ghost: "none", hoverId: null };
    return {
      snap: {
        kind: p.kind === "intersection" || p.kind === "circleLine" ? "intersection" : "point",
        x: p.x,
        y: p.y,
      },
      ghost: "point",
      hoverId: null,
    };
  }

  if (session.verb === "circle" && session.center) {
    return { snap: null, ghost: "ring", hoverId: null };
  }

  if (session.verb === "offset" && session.from?.kind === "line") {
    return {
      snap: null,
      ghost: "parallel",
      lineBasis: { origin: session.from.origin, dir: session.from.dir },
      hoverId: null,
    };
  }

  if (session.verb === "offset" && !session.from) {
    const hit = resolveDistanceFrom(ctx);
    if (hit.kind === "line") {
      const hoverId =
        ctx.hit?.target === "geom" &&
        (ctx.hit.drawable.geom.kind === "segment" || ctx.hit.drawable.geom.kind === "line")
          ? ctx.hit.drawable.geom.id
          : null;
      return { snap: null, ghost: "none", hoverId };
    }
    return { snap: null, ghost: "none", hoverId: null };
  }

  if (!("from" in session) || !session.from) {
    const hit = resolveDistanceFrom(ctx);
    if (hit.kind === "point") {
      return {
        snap: {
          kind:
            hit.point.kind === "intersection" || hit.point.kind === "circleLine"
              ? "intersection"
              : "point",
          x: hit.point.x,
          y: hit.point.y,
        },
        ghost: "point",
        hoverId: null,
      };
    }
    if (hit.kind === "line") {
      const hoverId =
        ctx.hit?.target === "geom" &&
        (ctx.hit.drawable.geom.kind === "segment" || ctx.hit.drawable.geom.kind === "line")
          ? ctx.hit.drawable.geom.id
          : null;
      return { snap: null, ghost: "none", hoverId };
    }
    return {
      snap: { kind: "point", x: ctx.world.x, y: ctx.world.y },
      ghost: "point",
      hoverId: null,
    };
  }

  if (session.from.kind === "point") {
    return { snap: null, ghost: "ring", hoverId: null };
  }
  return {
    snap: null,
    ghost: "parallel",
    lineBasis: { origin: session.from.origin, dir: session.from.dir },
    hoverId: null,
  };
}

function uniqueHoists(binds: LineBind[]): SourceAt[] {
  const seen = new Set<string>();
  const out: SourceAt[] = [];
  for (const b of binds) {
    if (b.kind !== "site") continue;
    const k = `${b.site.line}:${b.site.column}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(b.site);
  }
  return out;
}

function hoistNames(src: string, sites: SourceAt[]): { src: string; map: Map<string, string> } {
  let next = src;
  const map = new Map<string, string>();
  for (const site of sites) {
    const r = bindLineAt(next, site);
    if (!r) throw new Error("That geometry has no construction site in scene().");
    next = r.source;
    map.set(`${site.line}:${site.column}`, r.name);
  }
  return { src: next, map };
}

function lineText(
  bind: LineBind,
  map: Map<string, string>,
  imports: { geom: Set<string> },
): string {
  if (bind.kind === "named") return bind.field === "line" ? `${bind.name}.line` : bind.name;
  if (bind.kind === "expr") {
    imports.geom.add("offsetLine");
    return bind.expr;
  }
  const n = map.get(`${bind.site.line}:${bind.site.column}`);
  if (!n) throw new Error("unbound line");
  return bind.field === "line" ? `${n}.line` : n;
}

function collectLines(from: FromBind | PointBind): LineBind[] {
  if (from.kind === "intersection") return [from.a, from.b];
  if (from.kind === "circleLine") return [from.line];
  if (from.kind === "line") return [from.line];
  if (from.kind === "point") return collectLines(from.point);
  return [];
}

function pointExpr(
  working: string,
  statements: string[],
  point: PointBind,
  map: Map<string, string>,
  imports: { euclid: Set<string>; geom: Set<string> },
): string {
  if (point.kind === "named") return point.name;
  if (point.kind === "free") {
    const name = nextBindingName(`${working}\n${statements.join("\n")}`, "p");
    imports.geom.add("point");
    statements.push(`const ${name} = point(${fmt(point.x)}, ${fmt(point.y)});`);
    return name;
  }
  if (point.kind === "circleLine") {
    imports.geom.add("circleLineIntersection");
    const name = nextBindingName(`${working}\n${statements.join("\n")}`, "x");
    const k = point.k === 1 ? "+1" : "-1";
    statements.push(
      `const ${name} = circleLineIntersection(${point.circle}, ${lineText(point.line, map, imports)}, ${k});`,
    );
    return name;
  }
  imports.geom.add("lineIntersection");
  const name = nextBindingName(`${working}\n${statements.join("\n")}`, "x");
  statements.push(
    `const ${name} = lineIntersection(${lineText(point.a, map, imports)}, ${lineText(point.b, map, imports)});`,
  );
  return name;
}

function patchOf(
  sites: SourceAt[],
  imports: { euclid: Set<string>; geom: Set<string> },
  statements: string[],
  exprs?: string[],
): ScenePatch {
  return {
    hoistAt: sites.length ? sites : undefined,
    imports: {
      ...(imports.euclid.size ? { "@design-scenes/euclid2": [...imports.euclid] } : {}),
      ...(imports.geom.size ? { "@design-scenes/geom": [...imports.geom] } : {}),
    },
    statements,
    exprs: exprs && exprs.length ? exprs : undefined,
  };
}

export function compilePoint(src: string, point: PointBind): ScenePatch | { error: string } {
  if (point.kind === "named") return { error: "Already a point." };
  const sites = uniqueHoists(collectLines(point));
  try {
    const { src: working, map } = hoistNames(src, sites);
    const statements: string[] = [];
    const imports = { euclid: new Set<string>(), geom: new Set<string>() };
    pointExpr(working, statements, point, map, imports);
    return patchOf(sites, imports, statements);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

function samePoint(a: PointBind, b: PointBind): boolean {
  if (a.kind === "named" && b.kind === "named") return a.name === b.name;
  return Math.hypot(a.x - b.x, a.y - b.y) < 0.05;
}

export function compileLine(src: string, a: PointBind, b: PointBind): ScenePatch | { error: string } {
  if (samePoint(a, b)) return { error: "Pick two different points." };
  const sites = uniqueHoists([...collectLines(a), ...collectLines(b)]);
  try {
    const { src: working, map } = hoistNames(src, sites);
    const statements: string[] = [];
    const imports = { euclid: new Set<string>(), geom: new Set<string>() };
    const ae = pointExpr(working, statements, a, map, imports);
    const be = pointExpr(working, statements, b, map, imports);
    imports.geom.add("line");
    const name = nextBindingName(`${working}\n${statements.join("\n")}`, "ln");
    statements.push(`const ${name} = line(${ae}, ${be});`);
    return patchOf(sites, imports, statements);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export function compileSegment(src: string, a: PointBind, b: PointBind): ScenePatch | { error: string } {
  if (samePoint(a, b)) return { error: "Pick two different points." };
  const sites = uniqueHoists([...collectLines(a), ...collectLines(b)]);
  try {
    const { src: working, map } = hoistNames(src, sites);
    const statements: string[] = [];
    const imports = { euclid: new Set<string>(), geom: new Set<string>() };
    const ae = pointExpr(working, statements, a, map, imports);
    const be = pointExpr(working, statements, b, map, imports);
    imports.geom.add("segment");
    const name = nextBindingName(`${working}\n${statements.join("\n")}`, "seg");
    statements.push(`const ${name} = segment(${ae}, ${be});`);
    return patchOf(sites, imports, statements);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

function lengthArg(
  working: string,
  statements: string[],
  length: LengthBind,
  map: Map<string, string>,
  imports: { euclid: Set<string>; geom: Set<string> },
  centerExpr?: string,
  lineExpr?: string,
): string {
  if (length.kind === "fresh") return fmt(length.value);
  if (length.kind === "reuse") return length.negate ? `-${length.name}` : length.name;
  if (length.kind === "field") {
    const t = `${length.object}.${length.field}`;
    return length.negate ? `-${t}` : t;
  }
  if (length.kind === "dist") {
    if (!centerExpr) throw new Error("dist needs a center");
    const q = pointExpr(working, statements, length.other, map, imports);
    imports.geom.add("dist");
    return `dist(${centerExpr}, ${q})`;
  }
  if (!lineExpr) throw new Error("signedDist needs a line");
  const q = pointExpr(working, statements, length.other, map, imports);
  imports.geom.add("signedDist");
  return `signedDist(${q}, ${lineExpr})`;
}

function lengthHoists(length: LengthBind): LineBind[] {
  if (length.kind === "dist" || length.kind === "signedDist") return collectLines(length.other);
  return [];
}

export function compileCircle(
  src: string,
  center: PointBind,
  length: LengthBind,
): ScenePatch | { error: string } {
  const sites = uniqueHoists([...collectLines(center), ...lengthHoists(length)]);
  try {
    const { src: working, map } = hoistNames(src, sites);
    const statements: string[] = [];
    const imports = { euclid: new Set<string>(), geom: new Set<string>() };
    const c = pointExpr(working, statements, center, map, imports);
    const arg = lengthArg(working, statements, length, map, imports, c);
    imports.geom.add("circle");
    const name = nextBindingName(`${working}\n${statements.join("\n")}`, "k");
    statements.push(`const ${name} = circle(${c}, ${arg});`);
    return patchOf(sites, imports, statements);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export function compileOffset(
  src: string,
  from: Extract<FromBind, { kind: "line" }>,
  length: LengthBind,
): ScenePatch | { error: string } {
  const sites = uniqueHoists([...collectLines(from), ...lengthHoists(length)]);
  try {
    const { src: working, map } = hoistNames(src, sites);
    const statements: string[] = [];
    const imports = { euclid: new Set<string>(), geom: new Set<string>() };
    const lineE = lineText(from.line, map, imports);
    const arg = lengthArg(working, statements, length, map, imports, undefined, lineE);
    imports.geom.add("offsetLine");
    const name = nextBindingName(`${working}\n${statements.join("\n")}`, "off");
    statements.push(`const ${name} = offsetLine(${lineE}, ${arg});`);
    return patchOf(sites, imports, statements);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export function compileSlider(src: string, n: number): ScenePatch | { error: string } {
  const imports = { euclid: new Set<string>(["slider"]), geom: new Set<string>() };
  const name = nextBindingName(src, "r");
  return patchOf([], imports, [`const ${name} = slider(${fmt(n)});`]);
}

export function compileDistance(
  src: string,
  from: FromBind,
  length: LengthBind,
): ScenePatch | { error: string } {
  const sites = uniqueHoists([
    ...collectLines(from),
    ...(from.kind === "point" ? collectLines(from.point) : []),
  ]);
  try {
    const { src: working, map } = hoistNames(src, sites);
    const statements: string[] = [];
    const imports = { euclid: new Set<string>(), geom: new Set<string>() };
    if (from.kind === "point") {
      const p = pointExpr(working, statements, from.point, map, imports);
      imports.euclid.add("editDistanceToPoint");
      const dName = nextBindingName(`${working}\n${statements.join("\n")}`, "d");
      const arg =
        length.kind === "reuse"
          ? length.name
          : length.kind === "fresh"
            ? fmt(length.value)
            : length.kind === "field"
              ? `${length.object}.${length.field}`
              : fmt(0);
      statements.push(`const ${dName} = editDistanceToPoint(${p}, ${arg});`);
    } else {
      const lineE = lineText(from.line, map, imports);
      imports.euclid.add("editOffsetFromLine");
      const off = nextBindingName(`${working}\n${statements.join("\n")}`, "off");
      const arg =
        length.kind === "reuse"
          ? length.negate
            ? `-${length.name}`
            : length.name
          : length.kind === "fresh"
            ? fmt(length.value)
            : length.kind === "field"
              ? `${length.negate ? "-" : ""}${length.object}.${length.field}`
              : fmt(0);
      statements.push(`const ${off} = editOffsetFromLine(${lineE}, ${arg});`);
    }
    return patchOf(sites, imports, statements);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export function signedOffset(origin: Vec2, dir: Vec2, world: Vec2): number {
  return dot(sub(world, origin), perp(dir));
}

export function radiusBetween(a: Vec2, b: Vec2): number {
  return Math.max(0.05, dist(a, b));
}

function commitOrError(patch: ScenePatch | { error: string }): SessionResult {
  if ("error" in patch) return { kind: "error", message: patch.error };
  return { kind: "commit", patch };
}

export function onSessionClick(session: ToolSession, ctx: PickCtx, src: string): SessionResult {
  if (session.verb === "point") {
    const p = resolvePoint(ctx);
    if (p === "ignore") return { kind: "session", session };
    if (p.kind === "named") {
      return { kind: "error", message: "Already a point." };
    }
    return commitOrError(compilePoint(src, p));
  }

  if (session.verb === "line") {
    const p = resolvePoint(ctx);
    if (p === "ignore") return { kind: "session", session };
    if (!session.a) return { kind: "session", session: { verb: "line", a: p } };
    if (samePoint(session.a, p)) {
      return { kind: "error", message: "Pick two different points." };
    }
    return commitOrError(compileLine(src, session.a, p));
  }

  if (session.verb === "segment") {
    const p = resolvePoint(ctx);
    if (p === "ignore") return { kind: "session", session };
    if (!session.a) return { kind: "session", session: { verb: "segment", a: p } };
    if (samePoint(session.a, p)) {
      return { kind: "error", message: "Pick two different points." };
    }
    return commitOrError(compileSegment(src, session.a, p));
  }

  if (session.verb === "slider") {
    const typed = session.typed?.trim() ? Number(session.typed) : NaN;
    if (Number.isFinite(typed)) return commitOrError(compileSlider(src, typed));
    return commitOrError(compileSlider(src, Math.max(0.05, Math.hypot(ctx.world.x, ctx.world.y) || 1)));
  }

  if (session.verb === "circle") {
    if (!session.center) {
      const p = resolvePoint(ctx);
      if (p === "ignore") return { kind: "session", session };
      if (session.lengthReuse) {
        return commitOrError(
          compileCircle(src, p, { kind: "reuse", name: session.lengthReuse.name }),
        );
      }
      return { kind: "session", session: { verb: "circle", center: p, typed: session.typed } };
    }
    const len = resolveLength(ctx, "circle");
    if (len === "ignore") return { kind: "session", session };
    if (len !== "measure") return commitOrError(compileCircle(src, session.center, len));
    const typed = session.typed?.trim() ? Number(session.typed) : NaN;
    if (Number.isFinite(typed)) {
      return commitOrError(compileCircle(src, session.center, { kind: "fresh", value: typed }));
    }
    if (session.lengthReuse) {
      return commitOrError(
        compileCircle(src, session.center, { kind: "reuse", name: session.lengthReuse.name }),
      );
    }
    return commitOrError(
      compileCircle(src, session.center, {
        kind: "fresh",
        value: radiusBetween(session.center, ctx.world),
      }),
    );
  }

  if (session.verb === "offset") {
    if (!session.from) {
      const hit = resolveDistanceFrom(ctx);
      if (hit.kind === "ignore") return { kind: "session", session };
      if (hit.kind === "noSite") {
        return {
          kind: "error",
          message: "That geometry has no construction site in scene() — library strokes cannot bind.",
        };
      }
      if (hit.kind === "earlyLength") {
        return {
          kind: "session",
          session: { verb: "offset", lengthReuse: { name: hit.name, signed: false }, typed: session.typed },
        };
      }
      if (hit.kind === "line") {
        return {
          kind: "session",
          session: {
            verb: "offset",
            from: { kind: "line", line: hit.line, origin: hit.origin, dir: hit.dir },
            lengthReuse: session.lengthReuse,
            typed: session.typed,
          },
        };
      }
      return { kind: "error", message: "Click a line to offset." };
    }
    if (session.from.kind !== "line") {
      return { kind: "error", message: "Click a line to offset." };
    }
    const from = session.from;
    const len = resolveLength(ctx, "offset");
    if (len === "ignore") return { kind: "session", session };
    if (len !== "measure") {
      let bind = len;
      if (bind.kind === "reuse" || bind.kind === "field") {
        const s = signedOffset(from.origin, from.dir, ctx.world);
        if (s < 0 && session.lengthReuse && !session.lengthReuse.signed) {
          bind = { ...bind, negate: true };
        }
      }
      return commitOrError(compileOffset(src, from, bind));
    }
    const typed = session.typed?.trim() ? Number(session.typed) : NaN;
    if (Number.isFinite(typed)) {
      return commitOrError(compileOffset(src, from, { kind: "fresh", value: typed }));
    }
    if (session.lengthReuse) {
      const s = signedOffset(from.origin, from.dir, ctx.world);
      return commitOrError(
        compileOffset(src, from, {
          kind: "reuse",
          name: session.lengthReuse.name,
          negate: s < 0 && !session.lengthReuse.signed,
        }),
      );
    }
    const s = signedOffset(from.origin, from.dir, ctx.world);
    const mag = Math.max(0.05, Math.abs(s));
    return commitOrError(compileOffset(src, from, { kind: "fresh", value: s < 0 ? -mag : mag }));
  }

  if (!session.from) {
    const hit = resolveDistanceFrom(ctx);
    if (hit.kind === "ignore") return { kind: "session", session };
    if (hit.kind === "noSite") {
      return {
        kind: "error",
        message: "That geometry has no construction site in scene() — library strokes cannot bind.",
      };
    }
    if (hit.kind === "earlyLength") {
      return {
        kind: "session",
        session: { ...session, lengthReuse: { name: hit.name, signed: false } },
      };
    }
    if (hit.kind === "point") {
      const next: ToolSession = { ...session, from: { kind: "point", point: hit.point } };
      if (session.lengthReuse) {
        return commitOrError(
          compileDistance(src, next.from!, { kind: "reuse", name: session.lengthReuse.name }),
        );
      }
      return { kind: "session", session: next };
    }
    if (hit.kind === "line") {
      return {
        kind: "session",
        session: {
          ...session,
          from: { kind: "line", line: hit.line, origin: hit.origin, dir: hit.dir },
        },
      };
    }
    const next: ToolSession = {
      ...session,
      from: { kind: "point", point: { kind: "free", x: ctx.world.x, y: ctx.world.y } },
    };
    if (session.lengthReuse) {
      return commitOrError(
        compileDistance(src, next.from!, { kind: "reuse", name: session.lengthReuse.name }),
      );
    }
    return { kind: "session", session: next };
  }

  const len = resolveLength(ctx);
  if (len === "ignore") return { kind: "session", session };
  if (len !== "measure") {
    if (session.from.kind === "line" && (len.kind === "reuse" || len.kind === "field") && !len.negate) {
      const s = signedOffset(session.from.origin, session.from.dir, ctx.world);
      if (s < 0 && session.lengthReuse && !session.lengthReuse.signed) {
        return commitOrError(compileDistance(src, session.from, { ...len, negate: true }));
      }
    }
    return commitOrError(compileDistance(src, session.from, len));
  }

  const typed = session.typed?.trim() ? Number(session.typed) : NaN;
  if (Number.isFinite(typed)) {
    return commitOrError(compileDistance(src, session.from, { kind: "fresh", value: typed }));
  }

  if (session.lengthReuse) {
    if (session.from.kind === "line") {
      const s = signedOffset(session.from.origin, session.from.dir, ctx.world);
      return commitOrError(
        compileDistance(src, session.from, {
          kind: "reuse",
          name: session.lengthReuse.name,
          negate: s < 0 && !session.lengthReuse.signed,
        }),
      );
    }
    return commitOrError(
      compileDistance(src, session.from, { kind: "reuse", name: session.lengthReuse.name }),
    );
  }

  if (session.from.kind === "point") {
    const p = session.from.point;
    return commitOrError(
      compileDistance(src, session.from, { kind: "fresh", value: radiusBetween(p, ctx.world) }),
    );
  }
  const s = signedOffset(session.from.origin, session.from.dir, ctx.world);
  const mag = Math.max(0.05, Math.abs(s));
  return commitOrError(compileDistance(src, session.from, { kind: "fresh", value: s < 0 ? -mag : mag }));
}

export function onSessionNumber(session: ToolSession, src: string, n: number): SessionResult {
  if (session.verb === "slider") {
    return commitOrError(compileSlider(src, n));
  }
  if (session.verb === "circle") {
    if (!session.center) return { kind: "error", message: "Pick a center first." };
    if (session.lengthReuse) {
      return commitOrError(
        compileCircle(src, session.center, { kind: "reuse", name: session.lengthReuse.name }),
      );
    }
    return commitOrError(compileCircle(src, session.center, { kind: "fresh", value: n }));
  }
  if (session.verb === "offset") {
    if (!session.from || session.from.kind !== "line") {
      return { kind: "error", message: "Pick a line first." };
    }
    if (session.lengthReuse) {
      return commitOrError(
        compileOffset(src, session.from, { kind: "reuse", name: session.lengthReuse.name }),
      );
    }
    return commitOrError(compileOffset(src, session.from, { kind: "fresh", value: n }));
  }
  if (session.verb !== "distance" || !session.from) {
    return { kind: "error", message: "Pick a from first." };
  }
  if (session.lengthReuse) {
    return commitOrError(
      compileDistance(src, session.from, { kind: "reuse", name: session.lengthReuse.name }),
    );
  }
  return commitOrError(compileDistance(src, session.from, { kind: "fresh", value: n }));
}
