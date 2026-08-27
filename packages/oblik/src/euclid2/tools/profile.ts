import type { TraceNode } from "@/eval/context";
import type { Branch, Circle, LineLike, ProfileEdge } from "@/geom";
import { alongK, lineBasis, projectOnCircle, projectOnLine } from "@/geom";
import { printExpr, parsePath, type Expr } from "@/source/expr";
import type { Camera2 } from "../camera";
import { isCrossing, type PlacePoint } from "../place";
import { namedStrokesThrough, snapStrokeCarrier } from "../pick";
import { dist, exprOfPlace, hoverBind, hoverPlace, previewCall } from "./common";
import { inSlot, nameField, previewName, withBind } from "./draft";
import type { Field, Ghost, PlaceHit, Placed, Preview, Scope, Tool, ToolSession } from "./types";

type ProfileSession = Extract<ToolSession, { verb: "profile" }>;
type CycleCarrier = ProfileSession["carriers"][number];

/** Fat snap so closing the cycle is easy even over other points. */
export const PROFILE_CLOSE_PX = 80;

const fields: Field<ProfileSession>[] = [nameField((s) => s.focus === "name")];

function needPoint(s: ProfileSession): boolean {
  return s.vertices.length === s.carriers.length;
}

function needCarrier(s: ProfileSession): boolean {
  return s.vertices.length === s.carriers.length + 1;
}

function canClose(s: ProfileSession): boolean {
  return needPoint(s) && s.vertices.length >= 2 && s.carriers.length >= 2;
}

function startLabel(s: ProfileSession): string {
  const e = s.vertices[0]?.expr;
  return e ? printExpr(e) : "start";
}

function sameVertex(a: Expr, b: Expr): boolean {
  if (a.kind === "ref" && b.kind === "ref") return a.name === b.name;
  return printExpr(a) === printExpr(b);
}

function vertexOf(hit: PlaceHit, scope: Scope): Placed | null {
  if (hit.point.kind === "ref") {
    return scope.points[hit.point.bind] ?? { expr: parsePath(hit.point.bind), at: hit.point.at };
  }
  if (isCrossing(hit.point)) return { expr: exprOfPlace(hit.point), at: hit.point.at };
  return null;
}

function placeFromVertex(v: Placed, trace: readonly { occ: number; bind?: string; id: string }[]): PlacePoint | null {
  const e = v.expr;
  if (e.kind === "ref") {
    const node = trace.find((n) => n.bind === e.name && n.occ === 0);
    return { kind: "ref", bind: e.name, id: node?.id ?? e.name, at: v.at };
  }
  if (e.kind !== "call") return null;
  const refs = e.args.filter((a): a is Extract<Expr, { kind: "ref" }> => a.kind === "ref").map((a) => a.name);
  const kArg = e.args.find((a) => a.kind === "num");
  const k = kArg && kArg.kind === "num" && (kArg.value === 1 || kArg.value === -1) ? kArg.value : undefined;
  if (e.name === "lineIntersection" && refs[0] && refs[1]) {
    return { kind: "lineIntersection", a: refs[0], b: refs[1], at: v.at };
  }
  if (e.name === "circleLineIntersection" && refs[0] && refs[1] && k != null) {
    return { kind: "circleLineIntersection", circle: refs[0], line: refs[1], k, at: v.at };
  }
  if (e.name === "circleCircleIntersection" && refs[0] && refs[1] && k != null) {
    return { kind: "circleCircleIntersection", a: refs[0], b: refs[1], k, at: v.at };
  }
  return null;
}

function carrierExpr(c: CycleCarrier): Expr {
  if (c.geom.kind === "circle") {
    return {
      kind: "call",
      name: "along",
      args: [c.expr, { kind: "num", value: c.k ?? 1 }],
    };
  }
  return c.expr;
}

function cycleItems(s: ProfileSession, extra: Expr[] = []): Expr[] {
  const items: Expr[] = [];
  const n = Math.max(s.vertices.length, s.carriers.length);
  for (let i = 0; i < n; i++) {
    const v = s.vertices[i];
    if (v) items.push(v.expr);
    const c = s.carriers[i];
    if (c) items.push(carrierExpr(c));
  }
  items.push(...extra);
  return items;
}

function edgeOn(carrier: LineLike | Circle, a: { x: number; y: number }, b: { x: number; y: number }, k?: Branch): ProfileEdge {
  if (carrier.kind === "circle") {
    return { a: projectOnCircle(carrier, a), b: projectOnCircle(carrier, b), carrier, k: k ?? 1 };
  }
  return { a: projectOnLine(carrier, a), b: projectOnLine(carrier, b), carrier };
}

function lastCircle(s: ProfileSession): CycleCarrier | undefined {
  const c = s.carriers[s.carriers.length - 1];
  return c?.geom.kind === "circle" ? c : undefined;
}

function flipLastK(s: ProfileSession): ProfileSession {
  const i = s.carriers.length - 1;
  const c = s.carriers[i];
  if (!c || c.geom.kind !== "circle") return s;
  const next = s.carriers.slice();
  next[i] = { ...c, k: c.k === -1 ? 1 : -1 };
  return { ...s, carriers: next };
}

function hoverK(c: Circle, from: { x: number; y: number }, world: { x: number; y: number }): Branch {
  return alongK(c, from, projectOnCircle(c, world));
}

/** Tail sits on the carrier at the current vertex; `tx,ty` is the walk direction. */
function arrowAt(
  carrier: LineLike | Circle,
  from: { x: number; y: number },
  world: { x: number; y: number },
  k?: Branch,
): { at: { x: number; y: number }; tx: number; ty: number } {
  if (carrier.kind === "circle") {
    const at = projectOnCircle(carrier, from);
    const radial = { x: at.x - carrier.center.x, y: at.y - carrier.center.y };
    const len = Math.hypot(radial.x, radial.y) || 1;
    const u = { x: radial.x / len, y: radial.y / len };
    const kk = k ?? hoverK(carrier, from, world);
    const tx = kk === 1 ? -u.y : u.y;
    const ty = kk === 1 ? u.x : -u.x;
    return { at, tx, ty };
  }
  const { dir } = lineBasis(carrier);
  const at = projectOnLine(carrier, from);
  const to = projectOnLine(carrier, world);
  const along = (to.x - at.x) * dir.x + (to.y - at.y) * dir.y;
  const sign = along < 0 ? -1 : 1;
  return { at, tx: dir.x * sign, ty: dir.y * sign };
}

/** True while Profile is the live tool — existing fills stay out of the way. */
export function profileHidesExisting(session: ToolSession | null | undefined): boolean {
  return session?.verb === "profile";
}

/** Named strokes through the current vertex, or `null` when not picking a carrier. */
export function profileEligibleCarriers(
  session: ToolSession | null | undefined,
  trace: readonly TraceNode[],
  camera: Camera2,
): ReadonlySet<string> | null {
  if (!session || session.verb !== "profile") return null;
  if (!needCarrier(session)) return null;
  const from = session.vertices[session.vertices.length - 1];
  if (!from) return null;
  return namedStrokesThrough(trace, from.at, camera);
}

export const profile: Tool<ProfileSession> = {
  spec: {
    id: "profile",
    title: "Profile",
    hint: "Named points or crossings, then existing strokes until the start. Circles need a direction.",
    prefix: "pr",
    aliases: ["face", "region", "loop", "fill"],
  },
  start: () => ({ verb: "profile", focus: "cycle", vertices: [], carriers: [], name: "" }),
  fields,
  focus: (s) => s.focus,
  setFocus: (s, id) => ({ ...s, focus: id === "name" ? "name" : "cycle" }),
  chrome: () => ({ hideFills: true }),
  tab(session, dir) {
    if (session.focus === "name") return { ...session, focus: "cycle" };
    if (dir === 1 && lastCircle(session)) return flipLastK(session);
    return { ...session, focus: "name" };
  },
  hit(session, hit, ctx) {
    if (needCarrier(session)) {
      const from = session.vertices[session.vertices.length - 1];
      const carrier = snapStrokeCarrier(ctx.trace, hit.world, ctx.camera, ctx.size, {
        through: from?.at,
      });
      return carrier
        ? { ...hit, carrier, point: { kind: "free", at: hit.world } }
        : { ...hit, carrier: undefined, point: { kind: "free", at: hit.world } };
    }
    if (canClose(session)) {
      const start = session.vertices[0]!;
      const max = PROFILE_CLOSE_PX / Math.max(8, ctx.camera.scale);
      if (dist(hit.world, start.at) <= max) {
        const point = placeFromVertex(start, ctx.trace);
        if (point) return { ...hit, point };
      }
    }
    return hit;
  },
  hover(session, hit, trace) {
    if (needCarrier(session) && hit.carrier) return hoverBind(trace, hit.carrier.bind);
    return hoverPlace(hit.point, trace);
  },
  click(session, hit, scope) {
    if (needPoint(session)) {
      const p = vertexOf(hit, scope);
      if (!p) return { session };
      const start = session.vertices[0];
      if (canClose(session) && start && sameVertex(p.expr, start.expr)) {
        return { insert: withBind(session, { from: "profile", args: [{ kind: "array", items: cycleItems(session) }] }) };
      }
      return { session: { ...session, vertices: [...session.vertices, p], focus: "cycle" } };
    }
    if (!hit.carrier) return { session };
    const from = session.vertices[session.vertices.length - 1];
    if (!from) return { session };
    const k = hit.carrier.geom.kind === "circle" ? hoverK(hit.carrier.geom, from.at, hit.world) : undefined;
    const next: CycleCarrier = {
      expr: { kind: "ref", name: hit.carrier.bind },
      geom: hit.carrier.geom,
      ...(k != null ? { k } : {}),
    };
    return { session: { ...session, carriers: [...session.carriers, next], focus: "cycle" } };
  },
  commit(session) {
    if (session.focus === "cycle") return { session: { ...session, focus: "name" } };
    return null;
  },
  ghost(session, place): Ghost | null {
    const edges: ProfileEdge[] = [];
    for (let i = 0; i < session.carriers.length; i++) {
      const a = session.vertices[i];
      const b = session.vertices[i + 1];
      const c = session.carriers[i]!;
      if (!a) continue;
      const to = b?.at ?? place?.world;
      if (!to) continue;
      edges.push(edgeOn(c.geom, a.at, to, c.k));
    }
    const from = session.vertices[session.vertices.length - 1];
    let hover: ProfileEdge | undefined;
    let arrow: { at: { x: number; y: number }; tx: number; ty: number } | undefined;
    if (needCarrier(session) && from && place?.carrier) {
      const k = place.carrier.geom.kind === "circle" ? hoverK(place.carrier.geom, from.at, place.world) : undefined;
      hover = edgeOn(place.carrier.geom, from.at, place.world, k);
      arrow = arrowAt(place.carrier.geom, from.at, place.world, k);
    } else if (needPoint(session) && from && session.carriers.length > 0 && place) {
      const c = session.carriers[session.carriers.length - 1]!;
      hover = edgeOn(c.geom, from.at, place.world, c.k);
      arrow = arrowAt(c.geom, from.at, place.world, c.k);
    }
    if (edges.length === 0 && !hover && session.vertices[0]) {
      return { kind: "point", at: session.vertices[0].at };
    }
    if (edges.length === 0 && !hover) return null;
    return { kind: "profile", edges, hover, arrow };
  },
  preview(session, place, scope): Preview {
    const spec = profile.spec;
    const bind = previewName(session, spec.prefix);
    const name = inSlot(session.focus === "name", bind);
    const extra: Expr[] = [];
    const from = session.vertices[session.vertices.length - 1];
    if (needCarrier(session) && place?.carrier) {
      const k = place.carrier.geom.kind === "circle" && from ? hoverK(place.carrier.geom, from.at, place.world) : undefined;
      extra.push(
        carrierExpr({
          expr: parsePath(place.carrier.bind),
          geom: place.carrier.geom,
          k,
        }),
      );
    } else if (needPoint(session) && place) {
      const p = vertexOf(place, scope);
      if (p) extra.push(p.expr);
    }
    const items = cycleItems(session, extra);
    const shown = items.length > 0 ? items : extra;
    const line = previewCall(
      "profile",
      [{ kind: "array", items: shown }],
      scope.used,
      ([cycle]) => `profile(${cycle ?? "[]"})`,
      name,
    );
    if (!session.vertices[0]) {
      if (place?.point.kind === "ref") {
        return { line, hint: `Click ${place.point.bind} to start.` };
      }
      if (place && isCrossing(place.point)) {
        return { line, hint: "Click the crossing to start." };
      }
      return { line, hint: spec.hint };
    }
    if (needCarrier(session)) {
      return {
        line,
        hint: place?.carrier
          ? `Click ${place.carrier.bind} to leave the point.`
          : "Click a named line, segment, or circle through this point.",
      };
    }
    if (canClose(session)) {
      const start = startLabel(session);
      return {
        line,
        hint: lastCircle(session)
          ? `Click ${start} to close. Tab flips the arc. Tab again to name it.`
          : `Click ${start} to close. Tab to name it.`,
      };
    }
    return { line, hint: "Click a named point or crossing on that carrier." };
  },
};
