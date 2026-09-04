import {
  asWalk,
  distToWalkBoundary,
  isFiniteWalk,
  polyContains,
  polysInterfere,
  polysTouch,
  tessellateWalk,
  walkContains,
  walkSvgPath,
  type WalkInput,
} from "./region";
import type { Loop, Polygon } from "./types";
import { dist, distToSegment, isFiniteVec, type Vec2 } from "./vec";


const EPS = 1e-9;

export function isPolygon(v: { kind: string }): v is Polygon {
  return v.kind === "polygon";
}

export function nanPolygon(): Polygon {
  return { kind: "polygon", boundary: [], holes: [] };
}

/**
 * Copy `pts` into a distinct ordered boundary. Consecutive duplicates and a
 * trailing repeat of the first point (an explicitly closed ring) are dropped;
 * closure is implicit last→first. `null` when fewer than three points remain.
 */
export function normalizeBoundary(pts: readonly Vec2[]): Vec2[] | null {
  if (!Array.isArray(pts)) return null;
  const out: Vec2[] = [];
  for (const p of pts) {
    if (!p || typeof p !== "object") return null;
    const { x, y } = p as Vec2;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const next = { x, y };
    const prev = out[out.length - 1];
    if (prev && dist(prev, next) < EPS) continue;
    out.push(next);
  }
  if (out.length >= 4 && dist(out[0]!, out[out.length - 1]!) < EPS) out.pop();
  return out.length >= 3 ? out : null;
}

export function isFinitePolygon(p: Polygon): boolean {
  if (p.boundary.length < 3) return false;
  if (!p.boundary.every((q) => isFiniteVec(q))) return false;
  return p.holes.every((h) => isFiniteWalk(h));
}

/** Same hole contract as regions: strictly inside, disjoint, no touching. */
export function polygonTopologyOk(p: Polygon): boolean {
  if (!isFinitePolygon(p)) return false;
  if (p.holes.length === 0) return true;
  const outerPoly = p.boundary;
  const holePolys: Vec2[][] = [];
  for (const hole of p.holes) {
    const poly = tessellateWalk(hole);
    if (poly.length < 3) return false;
    if (polysTouch(poly, outerPoly)) return false;
    for (const q of poly) {
      if (!polyContains(outerPoly, q)) return false;
    }
    holePolys.push(poly);
  }
  for (let i = 0; i < holePolys.length; i++) {
    for (let j = i + 1; j < holePolys.length; j++) {
      if (polysInterfere(holePolys[i]!, holePolys[j]!)) return false;
    }
  }
  return true;
}

/** Parse holes with region walk semantics (full circle or carrier cycle). */
function asHoles(holes: readonly WalkInput[]): Loop[] | null {
  const out: Loop[] = [];
  for (const hole of holes) {
    const parsed = asWalk(hole);
    if (!parsed) return null;
    out.push(parsed);
  }
  return out;
}

export function polygonValue(boundary: readonly Vec2[], holes: readonly WalkInput[]): Polygon {
  const pts = normalizeBoundary(boundary);
  if (!pts || !Array.isArray(holes)) return nanPolygon();
  const parsedHoles = asHoles(holes);
  if (!parsedHoles) return nanPolygon();
  const p: Polygon = { kind: "polygon", boundary: pts, holes: parsedHoles };
  return polygonTopologyOk(p) ? p : nanPolygon();
}

export function polygonContains(p: Polygon, q: Vec2): boolean {
  if (!isFinitePolygon(p) || !isFiniteVec(q)) return false;
  if (!polyContains(p.boundary, q)) return false;
  for (const hole of p.holes) {
    if (walkContains(hole, q)) return false;
  }
  return true;
}

/** Unsigned distance to the boundary — outer straight edges and hole walks. */
export function distToPolygonBoundary(p: Polygon, q: Vec2): number {
  let best = Infinity;
  const n = p.boundary.length;
  for (let i = 0; i < n; i++) {
    const a = p.boundary[i]!;
    const b = p.boundary[(i + 1) % n]!;
    const d = distToSegment(q, a, b);
    if (d < best) best = d;
  }
  for (const hole of p.holes) {
    const d = distToWalkBoundary(hole, q);
    if (d < best) best = d;
  }
  return best;
}

export function distToPolygon(p: Polygon, q: Vec2): number {
  if (!isFinitePolygon(p)) return Infinity;
  if (polygonContains(p, q)) return 0;
  return distToPolygonBoundary(p, q);
}

/** Positive outside (grows a round offset); negative inside. */
export function signedDistToPolygon(p: Polygon, q: Vec2): number {
  if (!isFinitePolygon(p) || !isFiniteVec(q)) return Number.NaN;
  const d = distToPolygonBoundary(p, q);
  if (!Number.isFinite(d)) return Number.NaN;
  return polygonContains(p, q) ? -d : d;
}

export function boundarySvgPath(boundary: readonly Vec2[]): string {
  if (boundary.length < 3) return "";
  const first = boundary[0]!;
  const parts = [`M ${first.x} ${first.y}`];
  for (let i = 1; i < boundary.length; i++) {
    parts.push(`L ${boundary[i]!.x} ${boundary[i]!.y}`);
  }
  parts.push("Z");
  return parts.join(" ");
}

/** One even-odd path: boundary `Z` plus each hole `Z`. */
export function polygonSvgPath(p: Polygon): string {
  if (!isFinitePolygon(p)) return "";
  const parts = [boundarySvgPath(p.boundary)];
  for (const hole of p.holes) {
    const d = walkSvgPath(hole, true);
    if (d.length > 0) parts.push(d);
  }
  return parts.filter((d) => d.length > 0).join(" ");
}
