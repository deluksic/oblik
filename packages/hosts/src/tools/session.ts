import type { Camera, Gizmo, Hit } from "@design-scenes/euclid2";
import { hitsNear } from "@design-scenes/euclid2";
import {
  add,
  dist,
  distToLine,
  dot,
  line,
  lineIntersection,
  perp,
  sub,
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
  widgetInSceneFunction,
  type ScenePatch,
  type SourceAt,
} from "@design-scenes/shell";

import type { CommandPreview, EditorTool } from "../editors";

export type LineBind =
  | { kind: "named"; name: string }
  | { kind: "site"; site: SourceAt }
  | { kind: "expr"; expr: string };

export type PointBind =
  | { kind: "named"; name: string; x: number; y: number }
  | { kind: "free"; x: number; y: number }
  | { kind: "intersection"; a: LineBind; b: LineBind; x: number; y: number };

export type FromBind =
  | { kind: "point"; point: PointBind }
  | { kind: "line"; line: LineBind; origin: Vec2; dir: Vec2 };

export type LengthBind =
  | { kind: "fresh"; value: number }
  | { kind: "reuse"; name: string; negate?: boolean };

export type ToolSession =
  | { verb: "point" }
  | { verb: "line"; a?: PointBind }
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
): { bind: LineBind; line: LineLike; id: string } | null {
  const g = d.geom;
  if (g.kind !== "segment" && g.kind !== "line") return null;
  const site = siteAt(g.site, sceneFile);
  if (!site) return null;
  return { bind: { kind: "site", site }, line: g, id: g.id };
}

function offsetAsLine(
  src: string,
  g: Extract<Gizmo, { kind: "offset" }>,
): { bind: LineBind; line: LineLike; id: string } | null {
  const name = gizmoName(src, g);
  const base = editCallArgText(src, { line: g.at.line, column: g.at.column }, 0);
  if (!name || !base) return null;
  return {
    bind: { kind: "expr", expr: `offsetLine(${base}, ${name})` },
    line: line(g.origin, add(g.origin, g.direction)),
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
    push(lineWithSite(d, ctx.sceneFile));
  }
  const maxW = 8 / ctx.cam.scale;
  for (const g of ctx.gizmos) {
    if (g.kind !== "offset") continue;
    if (distToLine(ctx.world, g.origin, g.direction) > maxW) continue;
    push(offsetAsLine(ctx.sceneSrc, g));
  }
  return out;
}

export function resolveCrossing(ctx: PickCtx): PointBind | null {
  const likes = lineLikesNear(ctx);
  if (likes.length < 2) return null;
  for (let i = 0; i < likes.length - 1; i++) {
    for (let j = i + 1; j < likes.length; j++) {
      const a = likes[i]!;
      const b = likes[j]!;
      const pt = lineIntersection(a.line, b.line);
      if (!pt) continue;
      if (Math.hypot(pt.x - ctx.world.x, pt.y - ctx.world.y) > 0.35) continue;
      return { kind: "intersection", a: a.bind, b: b.bind, x: pt.x, y: pt.y };
    }
  }
  return null;
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

export function resolveLength(ctx: PickCtx): LengthBind | "ignore" | "measure" {
  if (ctx.hit?.target === "gizmo") {
    const g = ctx.hit.gizmo;
    if (g.kind === "distance" || g.kind === "offset" || g.kind === "number") {
      const name = gizmoName(ctx.sceneSrc, g);
      if (!name) return "ignore";
      return { kind: "reuse", name };
    }
    return "ignore";
  }
  if (ctx.hit?.target === "geom") return "ignore";
  return "measure";
}

export function sessionAsGhostTool(session: ToolSession, hover: SessionHover | null): EditorTool {
  if (session.verb === "point") return { id: "point" };
  if (session.verb === "line") {
    if (!session.a) return { id: "point" };
    const p = session.a;
    return {
      id: "infiniteLine",
      a: {
        x: p.x,
        y: p.y,
        ...(p.kind === "named" ? { name: p.name } : {}),
      },
    };
  }
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
  return null;
}

export function sessionPreview(session: ToolSession | null): CommandPreview | null {
  if (!session) return null;
  if (session.verb === "point") {
    return {
      previewHtml: fn("editPoint", [slot("<x>"), slot("<y>")]),
      hint: "Click empty paper or a line crossing.",
    };
  }
  if (session.verb === "line") {
    const a = session.a
      ? session.a.kind === "named"
        ? filled(session.a.name)
        : session.a.kind === "intersection"
          ? filled("lineIntersection")
          : slot("<a>", "", "done")
      : slot("<a>");
    const b = slot("<b>", "", session.a ? "active" : "pending");
    return {
      previewHtml: fn("line", [a, b]),
      hint: session.a ? "Click the second point." : "Click the first point.",
    };
  }
  const dSlot = session.lengthReuse
    ? filled(session.lengthReuse.name)
    : slot(session.typed?.trim() ? session.typed : "<d>", session.from ? "is-number" : "", session.from ? "active" : "pending");
  if (!session.from) {
    return {
      previewHtml: fn("distance", [slot("<from>"), dSlot]),
      hint: session.lengthReuse
        ? "Length reused. Click a point or a scene line."
        : "Click a point, a crossing, a scene line, or an offset handle.",
    };
  }
  if (session.from.kind === "point") {
    const p =
      session.from.point.kind === "named"
        ? filled(session.from.point.name)
        : session.from.point.kind === "intersection"
          ? filled("lineIntersection")
          : slot("<point>", "", "done");
    return {
      previewHtml: fn("editDistanceToPoint", [p, dSlot]),
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
  if (session.verb === "point" || session.verb === "line") {
    const p = resolvePoint(ctx);
    if (p === "ignore") return { snap: null, ghost: "none", hoverId: null };
    return {
      snap: {
        kind: p.kind === "intersection" ? "intersection" : "point",
        x: p.x,
        y: p.y,
      },
      ghost: "point",
      hoverId: null,
    };
  }

  if (!session.from) {
    const hit = resolveDistanceFrom(ctx);
    if (hit.kind === "point") {
      return {
        snap: {
          kind: hit.point.kind === "intersection" ? "intersection" : "point",
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
  if (bind.kind === "named") return bind.name;
  if (bind.kind === "expr") {
    imports.geom.add("offsetLine");
    return bind.expr;
  }
  const n = map.get(`${bind.site.line}:${bind.site.column}`);
  if (!n) throw new Error("unbound line");
  return n;
}

function collectLines(from: FromBind | PointBind): LineBind[] {
  if (from.kind === "intersection") return [from.a, from.b];
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
    imports.euclid.add("editPoint");
    statements.push(`const ${name} = editPoint(${fmt(point.x)}, ${fmt(point.y)});`);
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
    statements.push(`line(${ae}, ${be});`);
    return patchOf(sites, imports, statements);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
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
      const arg = length.kind === "reuse" ? length.name : fmt(length.value);
      statements.push(`const ${dName} = editDistanceToPoint(${p}, ${arg});`);
    } else {
      const lineE = lineText(from.line, map, imports);
      imports.euclid.add("editOffsetFromLine");
      const off = nextBindingName(`${working}\n${statements.join("\n")}`, "off");
      const arg =
        length.kind === "reuse" ? (length.negate ? `-${length.name}` : length.name) : fmt(length.value);
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
    if (session.from.kind === "line" && !len.negate) {
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
