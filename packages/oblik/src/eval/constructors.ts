import {
  circleCircleIntersectionValue,
  circleLineIntersectionValue,
  dist as distVec,
  isFiniteVec,
  isGlider,
  lineIntersectionValue,
  parallelLineValue,
  perpendicularLineValue,
  pointOnCircleValue,
  pointOnLineValue,
  pointOnSegmentValue,
  signedDist as signedDistValue,
  alongValue,
  filletValue,
  isCorner,
  isCsgOperand,
  isFiniteCsg2,
  isFinitePick,
  isFiniteRegion,
  isRegion,
  leftOfValue,
  nanCsg2,
  nanPick,
  nanPolarRepeat,
  nanRegion,
  regionValue,
  isFinitePolygon,
  nanPolygon,
  polygonValue,
  csg2Value,
  wrapCsg,
  offsetValue,
  pickValue,
  polarRepeatValue,
  rightOfValue,
  tangentLineValue,
  commonTangentLineValue,
  type Along,
  type Branch,
  type Circle,
  type Fillet,
  type Glider,
  type HalfPlane,
  type Line,
  type LineLike,
  type ParallelLine,
  type CsgOperand,
  type Point,
  type PolarRepeat,
  type Polygon,
  type Region,
  type WalkCycle,
  type WalkInput,
  type Csg2,
  type Pick,
  type Segment,
  type Vec2,
} from "../geom";
import {
  brand,
  currentEval,
  type SceneValue,
  type SliderValue,
  type TraceNode,
  type TraceValue,
} from "./context";
import { isFiniteImage, snapImageRot, type ImageRot, type ImageValue } from "./image";
import { memoized } from "./memo";
import {
  cloneStyle,
  lookOf,
  collectPaintTargets,
  type FigureStyle,
  type PaintValue,
  type StyleSpec,
} from "./paint";
import { $site, type SiteSpec } from "./site";
import { captureUserStack, EMPTY_STACK } from "./stack";

const { abs, max, min, round, sqrt } = Math;
function draftAt(id: string | undefined, i: number, fallback: number): number {
  if (!id) return fallback;
  const row = currentEval()?.draft.get(id);
  const v = row?.[i];
  return v !== undefined && Number.isFinite(v) ? v : fallback;
}

/**
 * Pair a recorded value with its node fields. `TraceNode` is a discriminated
 * union over `kind`, so the two must agree — deriving `kind` from the same
 * `value` here is what keeps every node consistent, and it is the only place
 * that pairing is made. TypeScript cannot correlate a generic `T` with the
 * mapped union on its own, so the one assertion lives here, next to the
 * correlation it relies on.
 */
function traceNodeOf<T extends TraceValue>(
  value: T,
  fields: Omit<TraceNode, "kind" | "value">,
): TraceNode {
  return { ...fields, kind: value.kind, value } as TraceNode;
}

function traced<T extends TraceValue>(value: T, id: string | undefined): T {
  const ctx = currentEval();
  if (!ctx || !id) return value;
  if (!isRecordable(value)) return value;
  const occ = ctx.occ.get(id) ?? 0;
  ctx.occ.set(id, occ + 1);
  const anno = ctx.annotations.get(id);
  const node = traceNodeOf(value, {
    id,
    occ,
    bind: anno?.bind,
    editable: anno?.editable === true,
    at: anno ? { line: anno.line, column: anno.column } : undefined,
    module: anno?.file ?? ctx.module,
    stack: ctx.captureStack ? captureUserStack() : EMPTY_STACK,
  });
  ctx.trace.push(node);
  return brand(value, node);
}

function isRecordable(v: TraceValue): boolean {
  if (v.kind === "style" || v.kind === "paint" || v.kind === "slider") return true;
  return isFiniteValue(v);
}

function isFiniteValue(v: { kind: string }): boolean {
  switch (v.kind) {
    case "point":
      return isFiniteVec(v as Point);
    case "segment": {
      const s = v as Segment;
      return isFiniteVec(s.a) && isFiniteVec(s.b);
    }
    case "line": {
      const l = v as Line;
      return isFiniteVec(l.origin) && isFiniteVec(l.direction);
    }
    case "circle": {
      const c = v as Circle;
      return isFiniteVec(c.center) && Number.isFinite(c.radius);
    }
    case "parallelLine": {
      const o = v as ParallelLine;
      return (
        isFiniteVec(o.line.origin) && isFiniteVec(o.line.direction) && Number.isFinite(o.distance)
      );
    }
    case "region":
      return isFiniteRegion(v as Region);
    case "polygon":
      return isFinitePolygon(v as Polygon);
    case "csg2":
      return isFiniteCsg2(v as Csg2);
    case "pick":
      return isFinitePick(v as Pick);
    case "image":
      return isFiniteImage(v as ImageValue);
    default:
      if (isGlider(v)) return isFiniteVec(v);
      return false;
  }
}

function mark<A extends SceneValue[], R extends SceneValue>(
  fn: (...args: A) => R,
  spec: SiteSpec,
): (...args: A) => R {
  const wrapped = memoized(fn);
  (wrapped as ((...args: A) => R) & { [$site]?: SiteSpec })[$site] = spec;
  return wrapped;
}

export const point = mark(
  (x: number, y: number, id?: string): Point => {
    const px = draftAt(id, 0, x);
    const py = draftAt(id, 1, y);
    return traced({ kind: "point", x: px, y: py }, id);
  },
  { dof: [0, 1] },
);

export const circle = mark(
  (center: Vec2, radius: number, id?: string): Circle => {
    const r = draftAt(id, 0, radius);
    return traced({ kind: "circle", center: { x: center.x, y: center.y }, radius: r }, id);
  },
  { dof: [1] },
);

export const segment = mark(
  (a: Vec2, b: Vec2, id?: string): Segment => {
    // Copy endpoints: embedding a glider value here nests the whole ancestor
    // tree, and trace reuse deep-compares values — exponential in recursion depth.
    return traced({ kind: "segment", a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y } }, id);
  },
  { dof: [] },
);

export const line = mark(
  (a: Vec2, b: Vec2, id?: string): Line => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l = sqrt(dx * dx + dy * dy);
    const direction = l < 1e-9 ? { x: 1, y: 0 } : { x: dx / l, y: dy / l };
    return traced({ kind: "line", origin: { x: a.x, y: a.y }, direction }, id);
  },
  { dof: [] },
);

export const parallelLine = mark(
  (geom: LineLike, signedD: number, id?: string): ParallelLine => {
    const d = draftAt(id, 0, signedD);
    return traced(parallelLineValue(geom, d), id);
  },
  { dof: [1] },
);

export const perpendicularLine = mark(
  (geom: LineLike, through: Vec2, id?: string): Line => {
    return traced(perpendicularLineValue(geom, through), id);
  },
  { dof: [] },
);

/** One of the two infinite tangents through point `p` to circle `c`, branch `k`. */
export const tangentPointCircle = mark(
  (p: Vec2, c: Circle, k: Branch, id?: string): Line => {
    return traced(tangentLineValue(c, p, k), id);
  },
  { dof: [] },
);

/** One of the two outer (direct) common tangents of circles `a` and `b`, side `k`. */
export const tangentCircleCircleOuter = mark(
  (a: Circle, b: Circle, k: Branch, id?: string): Line => {
    return traced(commonTangentLineValue(a, b, "outer", k), id);
  },
  { dof: [] },
);

/** One of the two inner (crossing) common tangents of circles `a` and `b`, side `k`. */
export const tangentCircleCircleInner = mark(
  (a: Circle, b: Circle, k: Branch, id?: string): Line => {
    return traced(commonTangentLineValue(a, b, "inner", k), id);
  },
  { dof: [] },
);

export const pointOnSegment = mark(
  (seg: Segment, t: number, id?: string): Glider => {
    const tt = draftAt(id, 0, t);
    return traced(pointOnSegmentValue(seg, tt), id);
  },
  { dof: [1] },
);

export const pointOnLine = mark(
  (geom: LineLike, s: number, id?: string): Glider => {
    const ss = draftAt(id, 0, s);
    return traced(pointOnLineValue(geom, ss), id);
  },
  { dof: [1] },
);

export const pointOnCircle = mark(
  (c: Circle, ux: number, uy: number, id?: string): Glider => {
    const u = draftAt(id, 0, ux);
    const v = draftAt(id, 1, uy);
    return traced(pointOnCircleValue(c, u, v), id);
  },
  { dof: [1, 2] },
);

export function signedDist(p: Vec2, geom: LineLike): number {
  return signedDistValue(p, geom);
}

export const lineIntersection = mark(
  (a: LineLike, b: LineLike, id?: string): Point => {
    const p = lineIntersectionValue(a, b);
    return traced({ kind: "point", x: p.x, y: p.y }, id);
  },
  { dof: [] },
);

export const circleLineIntersection = mark(
  (c: Circle, l: LineLike, k: Branch, id?: string): Point => {
    const p = circleLineIntersectionValue(c, l, k);
    return traced({ kind: "point", x: p.x, y: p.y }, id);
  },
  { dof: [] },
);

export const circleCircleIntersection = mark(
  (a: Circle, b: Circle, k: Branch, id?: string): Point => {
    const p = circleCircleIntersectionValue(a, b, k);
    return traced({ kind: "point", x: p.x, y: p.y }, id);
  },
  { dof: [] },
);

export function dist(a: Vec2, b: Vec2): number {
  return distVec(a, b);
}

/** Unmarked walk witness on a circle. Not a tape node. */
export function along(carrier: Circle, k: Branch): Along {
  return alongValue(carrier, k);
}

/** Unmarked vertex witness. Not a tape node. */
export function fillet(at: Vec2, r: number): Fillet {
  return filletValue(at, r);
}

/**
 * `count` copies of `cell` about `about`, `2π/count` apart, the ring spun by
 * `rotation` — a gear tooth, a bolt hole, a spoke.
 *
 * `cell` is authored **once, unrotated**: cell 0, the copy on the `+X` side of
 * `about`. It is either a closed walk (points and edges, the common case — the
 * ring of it is built here) or any CSG operand. Nothing expands: the field folds
 * the query point into the *nearest* copy and evaluates the cell once there, so
 * a 40-tooth gear costs one tooth per pixel and its record holds one tooth's
 * spans — which is why the cell has to be centred on its own sector and fit
 * inside it (`±π/count`, and never straddling the axis).
 *
 * An operand helper like `diff`/`leftOf`, not a tape node: nothing here is
 * drawn by itself. Hand it to `csg2(...)` (or to `roundOffset`, `pick`, a
 * boolean) to fill or inspect it.
 */
export function polarRepeat(
  cell: WalkInput | CsgOperand,
  count: number,
  about: Vec2,
  rotation = 0,
): PolarRepeat {
  const op = Array.isArray(cell)
    ? regionValue(cellChain(cell), [])
    : isCsgOperand(cell)
      ? cell
      : undefined;
  if (!op) return nanPolarRepeat();
  return polarRepeatValue(op, count, about, rotation);
}

/** A generated outline arrives as a chain of vertices, while `region` wants its
 * walked form — `[vertex, edge, vertex, edge, …]`, each edge the carrier that
 * runs to the *next* vertex. A chain of points is interleaved into that here, so
 * `polarRepeat(points, …)` reads like `polygon(points, …)`; a walk that already
 * carries its own edges is passed straight through. */
function cellChain(cell: WalkCycle): WalkCycle {
  const corners = asCornerChain(cell);
  if (!corners) return cell;
  const out: WalkCycle = [];
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i]!;
    const b = corners[(i + 1) % corners.length]!;
    out.push(
      { kind: "point", x: a.x, y: a.y },
      { kind: "segment", a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y } },
    );
  }
  return out;
}

/** The cell as a bare point chain — `undefined` when it carries its own edges. */
function asCornerChain(cell: WalkCycle): Vec2[] | undefined {
  if (cell.length === 0) return undefined;
  const out: Vec2[] = [];
  for (const item of cell) {
    if (!isCorner(item)) return undefined;
    out.push(item);
  }
  return out;
}

export const region = mark(
  (cycle: WalkInput, holes: readonly WalkInput[], id?: string): Region => {
    if (!Array.isArray(holes)) return traced(nanRegion(), id);
    return traced(regionValue(cycle, holes), id);
  },
  { dof: [] },
);

/**
 * Computed-boundary cheese: a closed chain of sampled points plus hole loops.
 * Holes are explicit — pass `[]` for none. Not a CSG operand; polygon has no
 * carrier families, so CSG / offset / trim never see it.
 */
export const polygon = mark(
  (boundary: readonly Vec2[], holes: readonly WalkInput[], id?: string): Polygon => {
    if (!Array.isArray(holes)) return traced(nanPolygon(), id);
    return traced(polygonValue(boundary, holes), id);
  },
  { dof: [] },
);

export const roundOffset = mark(
  (face: Region, distance: number, id?: string): Csg2 => {
    const d = draftAt(id, 0, distance);
    if (!face || typeof face !== "object" || !isRegion(face) || !isFiniteRegion(face)) {
      return nanCsg2();
    }
    if (!Number.isFinite(d)) return nanCsg2();
    return traced(wrapCsg(offsetValue(face, d)), id);
  },
  { dof: [1] },
);

/** Unmarked half-plane. Not a tape node. */
export function leftOf(geom: LineLike): HalfPlane {
  return leftOfValue(geom);
}

/** Unmarked half-plane. Not a tape node. */
export function rightOf(geom: LineLike): HalfPlane {
  return rightOfValue(geom);
}

/** Unmarked CSG difference. Not a tape node — wrap with `csg2()` to inspect/fill. */
export function diff(stock: CsgOperand, cutters: readonly CsgOperand[]): Csg2 {
  if (!Array.isArray(cutters)) return nanCsg2();
  return csg2Value("diff", [stock, ...cutters]);
}

/** Unmarked CSG union. Not a tape node — wrap with `csg2()` to inspect/fill. */
export function union(operands: readonly CsgOperand[]): Csg2 {
  if (!Array.isArray(operands)) return nanCsg2();
  return csg2Value("union", operands);
}

/** Unmarked CSG intersection. Not a tape node — wrap with `csg2()` to inspect/fill. */
export function intersect(operands: readonly CsgOperand[]): Csg2 {
  if (!Array.isArray(operands)) return nanCsg2();
  return csg2Value("intersect", operands);
}

/** Unmarked island pick. Not a tape node — wrap with `csg2()` to inspect/fill. */
export function pick(of: CsgOperand, at: Vec2): Pick {
  if (!at || typeof at !== "object") return nanPick();
  return pickValue(of, at);
}

/** Record a CSG field or pick on the tape for inspect/fill. */
export const csg2 = mark(
  (value: CsgOperand | Pick, id?: string): Csg2 | Pick => {
    if (!value || typeof value !== "object") return traced(nanCsg2(), id);
    if (value.kind === "csg2" && isFiniteCsg2(value)) return traced(value, id);
    if (value.kind === "pick" && isFinitePick(value)) return traced(value, id);
    // A bare operand — a repeat, a half-plane, an island pick — is drawn by
    // wrapping it in a one-operand union (see `wrapCsg`).
    return isCsgOperand(value) ? traced(wrapCsg(value), id) : traced(nanCsg2(), id);
  },
  { dof: [] },
);

/**
 * A raster reference on the paper — a screenshot, a photo, a scanned drawing —
 * drawn under the grid, the fills, the strokes and the points.
 *
 * The rect is explicit and **`x`/`y` is the pre-rotation corner**: `rot` turns
 * the rect about its own centre in 90° steps and `flip` mirrors it about the
 * vertical centre axis, so the world rect a rotated image occupies is
 * `h`-wide and `w`-tall. `fade ∈ [0, 1]` mixes the bitmap toward the paper
 * colour, which is what lets sketch lines read on top of a photograph.
 *
 * Not a `Geom` and not a CSG operand: nothing composes an image, so eval never
 * learns the bitmap's pixel dimensions. The import flow is what keeps the rect's
 * aspect ratio equal to the file's; uniform scale operations preserve it, and
 * independent `w`/`h` still allow deliberate distortion.
 */
export const image = mark(
  (
    src: string,
    x: number,
    y: number,
    w: number,
    h: number,
    rot: ImageRot,
    flip: 0 | 1,
    fade: number,
    id?: string,
  ): ImageValue => {
    const value: ImageValue = {
      kind: "image",
      src: typeof src === "string" ? src : "",
      x: draftAt(id, 0, x),
      y: draftAt(id, 1, y),
      w: draftAt(id, 2, w),
      h: draftAt(id, 3, h),
      rot: snapImageRot(draftAt(id, 4, rot)),
      flip: draftAt(id, 5, flip) ? 1 : 0,
      fade: draftAt(id, 6, fade),
    };
    return traced(value, id);
  },
  { dof: [1, 2, 3, 4, 5, 6, 7] },
);

export type SliderOpts = {
  min?: number;
  max?: number;
  step?: number;
};

function snapEditNumber(raw: number, minVal: number, maxVal: number, step: number): number {
  const clamped = min(maxVal, max(minVal, raw));
  if (!(step > 0)) return clamped;
  return round((clamped - minVal) / step) * step + minVal;
}

function tracedSlider(
  n: number,
  meta: Omit<SliderValue, "kind" | "n">,
  id: string | undefined,
): number {
  const ctx = currentEval();
  if (!ctx || !id) return n;
  const occ = ctx.occ.get(id) ?? 0;
  ctx.occ.set(id, occ + 1);
  const anno = ctx.annotations.get(id);
  const value: SliderValue = { kind: "slider", n, ...meta };
  const node: TraceNode = {
    id,
    occ,
    kind: "slider",
    value,
    bind: anno?.bind,
    editable: anno?.editable === true,
    at: anno ? { line: anno.line, column: anno.column } : undefined,
    module: anno?.file ?? ctx.module,
    stack: ctx.captureStack ? captureUserStack() : EMPTY_STACK,
  };
  ctx.trace.push(node);
  return n;
}

export const slider = mark(
  (n: number, opts?: SliderOpts, id?: string): number => {
    const raw = draftAt(id, 0, n);
    const minVal = opts?.min ?? min(0, raw);
    const maxVal = opts?.max ?? max(abs(raw) * 2, 1, minVal + 1);
    const step = opts?.step && opts.step > 0 ? opts.step : 0.01;
    const v = snapEditNumber(raw, minVal, maxVal, step);
    return tracedSlider(v, { min: minVal, max: maxVal, step }, id);
  },
  { dof: [0] },
);

/** Register a shared look. Pass the value to `paint`, or pass a spec object instead. */
export const style = mark(
  (spec: Omit<FigureStyle, "kind"> = {}, id?: string): FigureStyle => {
    return traced(cloneStyle(spec), id);
  },
  { dof: [] },
);

/** Walk branded geom in `object` and record a paint. Look is a `style()` value or a spec object. */
export const paint = mark(
  (object: SceneValue, look: FigureStyle | StyleSpec, id?: string): PaintValue => {
    const value: PaintValue = {
      kind: "paint",
      targets: collectPaintTargets(object),
      style: lookOf(look),
    };
    return traced(value, id);
  },
  { dof: [] },
);

export const constructors = {
  point,
  circle,
  segment,
  line,
  parallelLine,
  perpendicularLine,
  tangentPointCircle,
  tangentCircleCircleOuter,
  tangentCircleCircleInner,
  pointOnSegment,
  pointOnLine,
  pointOnCircle,
  lineIntersection,
  circleLineIntersection,
  circleCircleIntersection,
  slider,
  region,
  polygon,
  roundOffset,
  csg2,
  image,
  style,
  paint,
} as const;
