import { filletVertices } from "./offset";
import {
  isAlong,
  isCorner,
  isFillet,
  isFiniteRegion,
  isSpan,
  nanRegion,
  projectOnCircle,
  projectOnLine,
  regionTopologyOk,
  walkEdges,
  type WalkCycle,
  type WalkInput,
  type WalkItem,
  type WalkSpan,
} from "./region";
import type { Circle, Fillet, Loop, LoopEdge, Region } from "./types";
import { isFiniteVec, type Vec2 } from "./vec";

const { abs } = Math;
const EPS = 1e-9;

export function filletValue(at: Vec2, r: number): Fillet {
  return { kind: "fillet", at: { x: at.x, y: at.y }, r };
}

function asVertex(v: WalkItem): { at: Vec2; r: number } | undefined {
  if (!v || typeof v !== "object") return undefined;
  if (isFillet(v)) {
    if (!Number.isFinite(v.r) || v.r < 0) return undefined;
    if (!v.at || typeof v.at !== "object" || !isFiniteVec(v.at)) return undefined;
    return { at: { x: v.at.x, y: v.at.y }, r: v.r };
  }
  if (!isCorner(v) || !isFiniteVec(v)) return undefined;
  return { at: { x: v.x, y: v.y }, r: 0 };
}

function asCircleWalk(c: Circle): Circle | undefined {
  const center = c?.center;
  const radius = c?.radius;
  if (!center || typeof center !== "object" || !isFiniteVec(center)) return undefined;
  if (typeof radius !== "number" || abs(radius) < EPS) return undefined;
  return {
    kind: "circle",
    center: { x: center.x, y: center.y },
    radius: abs(radius),
  };
}

/** A full circle, or a cycle tape walked into its projected edge loop. */
export function asWalk(input: WalkInput): Loop | undefined {
  if (Array.isArray(input)) return walkFromCycle(input);
  return asCircleWalk(input);
}

type WalkCorner = { at: Vec2; r: number };
/** Parsed tape before projection. `vertices.length === carriers.length + 1`. */
type ParsedWalk = { vertices: WalkCorner[]; carriers: WalkSpan[] };

function parseWalkTape(cycle: WalkCycle): ParsedWalk | undefined {
  if (!Array.isArray(cycle) || cycle.length < 4 || cycle.length % 2 !== 0) return undefined;
  const n = cycle.length / 2;
  const vertices: WalkCorner[] = [];
  const carriers: WalkSpan[] = [];
  for (let i = 0; i < n; i++) {
    const vtx = asVertex(cycle[i * 2]!);
    if (!vtx) return undefined;
    vertices.push(vtx);
    const item = cycle[i * 2 + 1]!;
    if (!isSpan(item)) return undefined;
    if (isAlong(item)) {
      if (item.carrier.kind !== "circle") return undefined;
      carriers.push({ kind: "along", carrier: item.carrier, k: item.k < 0 ? -1 : 1 });
      continue;
    }
    carriers.push(item);
  }
  const first = vertices[0]!;
  vertices.push({ at: { x: first.at.x, y: first.at.y }, r: 0 });
  return { vertices, carriers };
}

function walkEdgesFromParsed(w: ParsedWalk): { edges: LoopEdge[]; radii: number[] } | undefined {
  const n = w.carriers.length;
  if (w.vertices.length !== n + 1) return undefined;
  const edges: LoopEdge[] = [];
  for (let i = 0; i < n; i++) {
    const a = w.vertices[i]!.at;
    const b = w.vertices[i + 1]!.at;
    const car = w.carriers[i]!;
    if (isAlong(car)) {
      const k = car.k < 0 ? -1 : 1;
      if (k !== 1 && k !== -1) return undefined;
      edges.push({
        a: projectOnCircle(car.carrier, a),
        b: projectOnCircle(car.carrier, b),
        carrier: car.carrier,
        k,
      });
    } else {
      edges.push({
        a: projectOnLine(car, a),
        b: projectOnLine(car, b),
        carrier: car,
      });
    }
  }
  const radii = w.vertices.slice(0, n).map((v) => v.r);
  return { edges, radii };
}

function parseWalk(cycle: WalkCycle): { edges: LoopEdge[]; radii: number[] } | undefined {
  const parsed = parseWalkTape(cycle);
  if (!parsed) return undefined;
  return walkEdgesFromParsed(parsed);
}

function walkFromCycle(cycle: WalkCycle): LoopEdge[] | undefined {
  const parsed = parseWalk(cycle);
  if (!parsed) return undefined;
  const sharp: Region = { kind: "region", outer: parsed.edges, holes: [] };
  if (!isFiniteRegion(sharp)) return undefined;
  const filleted = filletVertices(sharp, parsed.radii);
  if (!isFiniteRegion(filleted)) return undefined;
  const edges = walkEdges(filleted.outer);
  return edges.length >= 2 ? edges : undefined;
}

export function regionValue(cycle: WalkInput, holes: readonly WalkInput[]): Region {
  const outer = asWalk(cycle);
  if (!outer) return nanRegion();
  const parsed: Loop[] = [];
  for (const holeCycle of holes) {
    const hole = asWalk(holeCycle);
    if (!hole) return nanRegion();
    parsed.push(hole);
  }
  const p: Region = { kind: "region", outer, holes: parsed };
  if (!regionTopologyOk(p)) return nanRegion();
  return p;
}
