import { filletAtVertex, isFiniteRegion, regionCorners, walkEdges, type Region } from "@/geom";
import { printExpr, type Expr } from "@/source/expr";

import { snapRegion } from "../pick";
import { dist, exprOfPlace, hoverBind, isPinnedPoint, round, sameRef } from "./common";
import { inSlot, lengthField } from "./draft";
import {
  attachLengthHit,
  lengthHover,
  lengthLabel,
  lengthValue,
  resolveLengthExpr,
} from "./length";
import type { Field, PlaceHit, Preview, Scope, Tool, ToolSession } from "./types";


const { max } = Math;
type FilletSession = Extract<ToolSession, { verb: "fillet" }>;

const fields: Field<FilletSession>[] = [lengthField("<radius>")];

function closestCorner(geom: Region, world: { x: number; y: number }) {
  const corners = regionCorners(geom);
  let best = corners[0];
  if (!best) return null;
  let bestD = dist(world, best.at);
  for (const c of corners) {
    const d = dist(world, c.at);
    if (d < bestD) {
      best = c;
      bestD = d;
    }
  }
  return best;
}

function cornerOf(hit: PlaceHit, geom: Region) {
  if (hit.corner) return hit.corner;
  const c = closestCorner(geom, hit.world);
  return c ? { index: c.index, at: c.at } : null;
}

function faceGeom(session: FilletSession, scope: Scope): Region | undefined {
  if (session.faceBind && scope.regions[session.faceBind])
    return scope.regions[session.faceBind]!.geom;
  return session.geom;
}

function vertexOf(session: FilletSession) {
  if (session.vertex == null || !session.at || !session.faceId) return null;
  return { index: session.vertex, at: session.at, id: session.faceId };
}

function exprAtCorner(at: { x: number; y: number }, hit: PlaceHit, scope: Scope): Expr | undefined {
  if (isPinnedPoint(hit.point) && dist(hit.point.at, at) < 1e-4) return exprOfPlace(hit.point);
  for (const p of Object.values(scope.points)) {
    if (dist(p.at, at) < 1e-4) return p.expr;
  }
}

function vertexLabel(session: FilletSession, scope: Scope, place: PlaceHit | null): string {
  if (session.vertexExpr) return printExpr(session.vertexExpr);
  const p = place?.point;
  if (p && isPinnedPoint(p)) return printExpr(exprOfPlace(p));
  if (session.at) {
    for (const [name, pt] of Object.entries(scope.points)) {
      if (dist(pt.at, session.at) < 1e-4) return name;
    }
  }
  return "vertex";
}

function radiusAt(session: FilletSession, hit: PlaceHit): number {
  if (!session.at) return 0;
  const at = hit.point.kind === "free" ? hit.world : hit.point.at;
  return max(0, dist(at, session.at));
}

function radiusExpr(session: FilletSession, hit: PlaceHit, scope: Scope): Expr {
  const bound = resolveLengthExpr(session, scope, { min: 0 });
  if (isPinnedPoint(hit.point) && session.vertexExpr && !sameRef(session.vertexExpr, hit.point)) {
    if (!bound || bound.kind === "num") {
      return { kind: "call", name: "dist", args: [session.vertexExpr, exprOfPlace(hit.point)] };
    }
    return bound;
  }
  if (hit.length && hit.length.value >= 0) return hit.length.expr;
  if (bound) return bound;
  if (isPinnedPoint(hit.point) && session.at) {
    return { kind: "num", value: round(max(0, dist(hit.point.at, session.at))) };
  }
  return { kind: "num", value: round(radiusAt(session, hit)) };
}

function radiusNumber(session: FilletSession, place: PlaceHit | null, scope: Scope): number {
  if (resolveLengthExpr(session, scope, { min: 0 }) != null) {
    const fallback = place?.length?.value ?? 0;
    return max(0, lengthValue(session, scope, fallback));
  }
  if (place?.length && place.length.value >= 0) {
    return max(0, lengthValue(session, scope, place.length.value));
  }
  if (
    place &&
    isPinnedPoint(place.point) &&
    session.vertexExpr &&
    !sameRef(session.vertexExpr, place.point)
  ) {
    return max(0, dist(place.point.at, session.at ?? place.point.at));
  }
  if (!place || !session.at) return 0;
  return radiusAt(session, place);
}

function patchJob(session: FilletSession, radius: Expr) {
  const v = vertexOf(session);
  if (!v) return { session };
  return {
    insert: {
      from: "fillet" as const,
      args: [radius],
      patchVertex: { id: v.id, index: v.index },
    },
  };
}

export const fillet: Tool<FilletSession> = {
  spec: {
    id: "fillet",
    title: "Fillet",
    hint: "Click a region corner, then a length: radius, parallel distance, slider, or a click.",
    prefix: "fil",
    aliases: ["corner"],
  },
  start: () => ({ verb: "fillet", focus: "corner", faceId: "", faceBind: "", typed: "" }),
  fields,
  focus: (s) => s.focus,
  setFocus: (s, id) => ({ ...s, focus: id as FilletSession["focus"] }),
  chrome(session) {
    if (vertexOf(session)) return {};
    return { muteStrokes: true, mutePoints: true, hideSnap: true };
  },
  hit(session, hit, ctx) {
    if (!vertexOf(session)) {
      const filter = ctx.keys ? { keys: ctx.keys, print: ctx.print } : undefined;
      const picked = snapRegion(ctx.trace, hit.world, ctx.camera, ctx.size, undefined, filter);
      if (!picked) return hit;
      const corner = closestCorner(picked.geom, hit.world);
      if (!corner) return { ...hit, region: picked };
      return { ...hit, region: picked, corner: { index: corner.index, at: corner.at } };
    }
    return attachLengthHit(hit, ctx, session, ["radius", "distance"]);
  },
  hover(session, hit, trace) {
    if (!vertexOf(session)) {
      if (!hit.region) return null;
      return hoverBind(trace, hit.region.bind);
    }
    return lengthHover(hit, trace);
  },
  click(session, hit, scope) {
    const vertex = vertexOf(session);
    if (!vertex) {
      if (!hit.region) return { session };
      const corner = cornerOf(hit, hit.region.geom);
      if (!corner) return { session };
      const id = hit.region.id;
      if (!id) return { session };
      return {
        session: {
          ...session,
          faceId: id,
          faceBind: hit.region.bind,
          geom: hit.region.geom,
          vertex: corner.index,
          at: corner.at,
          vertexExpr: exprAtCorner(corner.at, hit, scope),
          focus: "typed" as const,
        },
      };
    }
    const expr = radiusExpr(session, hit, scope);
    if (
      expr.kind === "num" &&
      expr.value === 0 &&
      !hit.length &&
      !resolveLengthExpr(session, scope, { min: 0 })
    ) {
      return { session };
    }
    return patchJob(session, expr);
  },
  commit(session, _place, scope) {
    if (!vertexOf(session)) {
      if (session.focus !== "corner") return { session: { ...session, focus: "corner" } };
      return null;
    }
    const bound = resolveLengthExpr(session, scope, { min: 0 });
    if (bound) return patchJob(session, bound);
    if (session.focus === "corner") return { session: { ...session, focus: "typed" } };
    return null;
  },
  ghost(session, place, scope) {
    const vertex = vertexOf(session);
    const geom = faceGeom(session, scope);
    if (!vertex) {
      const at =
        place?.corner?.at ??
        (place?.region ? closestCorner(place.region.geom, place.world)?.at : undefined);
      return at ? { kind: "corner" as const, at } : null;
    }
    if (!geom) return null;
    const r = radiusNumber(session, place, scope);
    const out = filletAtVertex(geom, vertex.index, r);
    if (!isFiniteRegion(out)) return null;
    return { kind: "region", edges: walkEdges(out.outer) };
  },
  preview(session, place, scope): Preview {
    const spec = fillet.spec;
    const vTok = inSlot(session.focus === "corner", vertexLabel(session, scope, place));
    const rLabel = lengthLabel(session, scope, "radius");
    const vertex = vertexOf(session);
    if (!vertex) {
      const r = inSlot(session.focus === "typed", rLabel);
      return {
        line: `region([…, fillet(${vTok}, ${r}), …], [])`,
        hint: place?.corner ? `Click to fillet this corner. Tab for radius.` : spec.hint,
      };
    }
    if (place?.length && place.length.value >= 0 && resolveLengthExpr(session, scope) == null) {
      const r = printExpr(place.length.expr);
      return {
        line: `region([…, fillet(${vTok}, ${r}), …], [])`,
        hint: "Click to reuse that length.",
      };
    }
    if (
      place &&
      isPinnedPoint(place.point) &&
      session.vertexExpr &&
      !sameRef(session.vertexExpr, place.point) &&
      resolveLengthExpr(session, scope) == null
    ) {
      const r = `dist(${printExpr(session.vertexExpr)}, ${printExpr(exprOfPlace(place.point))})`;
      return {
        line: `region([…, fillet(${vTok}, ${r}), …], [])`,
        hint: "Click to pin the radius to that distance.",
      };
    }
    const bound = resolveLengthExpr(session, scope, { min: 0 });
    const shown =
      rLabel !== "radius"
        ? rLabel
        : place
          ? String(round(radiusNumber(session, place, scope)))
          : "radius";
    const rTok = inSlot(session.focus === "typed", bound ? printExpr(bound) : shown);
    if (bound?.kind === "num" && bound.value === 0) {
      return {
        line: `region([…, ${vTok}, …], [])`,
        hint: "Radius 0 leaves the corner sharp.",
      };
    }
    return {
      line: `region([…, fillet(${vTok}, ${rTok}), …], [])`,
      hint: "Type a radius, slider, or field (reach.radius), click to reuse, or click to measure.",
    };
  },
};
