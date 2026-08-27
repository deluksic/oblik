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
  isFiniteProfile,
  isProfile,
  nanProfile,
  profileValue,
  roundOffsetValue,
  type Along,
  type Branch,
  type Circle,
  type Fillet,
  type Geom,
  type Line,
  type LineLike,
  type ParallelLine,
  type Point,
  type Profile,
  type Segment,
  type Vec2,
} from "../geom";
import { brand, currentEval, type SliderValue, type TraceNode, type TraceValue } from "./context";
import {
  cloneStyle,
  lookOf,
  collectPaintTargets,
  type FigureStyle,
  type PaintValue,
  type StyleSpec,
} from "./paint";
import { $site, type SiteSpec } from "./site";
import { captureUserStack } from "./stack";

function draftAt(id: string | undefined, i: number, fallback: number): number {
  if (!id) return fallback;
  const row = currentEval()?.draft.get(id);
  const v = row?.[i];
  return v != null && Number.isFinite(v) ? v : fallback;
}

function traced<T extends TraceValue>(value: T, id: string | undefined): T {
  const ctx = currentEval();
  if (!ctx || !id) return value;
  if (!isRecordable(value)) return value;
  const occ = ctx.occ.get(id) ?? 0;
  ctx.occ.set(id, occ + 1);
  const anno = ctx.annotations.get(id);
  const node: TraceNode = {
    id,
    occ,
    kind: value.kind,
    value,
    bind: anno?.bind,
    editable: anno?.editable === true,
    at: anno ? { line: anno.line, column: anno.column } : undefined,
    module: anno?.file ?? ctx.module,
    stack: captureUserStack(),
  };
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
      return isFiniteVec(o.line.origin) && isFiniteVec(o.line.direction) && Number.isFinite(o.distance);
    }
    case "profile":
      return isFiniteProfile(v as Profile);
    default:
      if (isGlider(v)) return isFiniteVec(v);
      return false;
  }
}

function mark<F extends (...args: never[]) => unknown>(fn: F, spec: SiteSpec): F {
  (fn as F & { [$site]: SiteSpec })[$site] = spec;
  return fn;
}

export const point = mark((x: number, y: number, id?: string): Point => {
  const px = draftAt(id, 0, x);
  const py = draftAt(id, 1, y);
  return traced({ kind: "point", x: px, y: py }, id);
}, { dof: [0, 1] });

export const circle = mark((center: Vec2, radius: number, id?: string): Circle => {
  const r = draftAt(id, 0, radius);
  return traced({ kind: "circle", center, radius: r }, id);
}, { dof: [1] });

export const segment = mark((a: Vec2, b: Vec2, id?: string): Segment => {
  return traced({ kind: "segment", a, b }, id);
}, { dof: [] });

export const line = mark((a: Vec2, b: Vec2, id?: string): Line => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l = Math.hypot(dx, dy);
  const direction = l < 1e-9 ? { x: 1, y: 0 } : { x: dx / l, y: dy / l };
  return traced({ kind: "line", origin: a, direction }, id);
}, { dof: [] });

export const parallelLine = mark((geom: LineLike, signedD: number, id?: string): ParallelLine => {
  const d = draftAt(id, 0, signedD);
  return traced(parallelLineValue(geom, d), id);
}, { dof: [1] });

export const perpendicularLine = mark((geom: LineLike, through: Vec2, id?: string): Line => {
  return traced(perpendicularLineValue(geom, through), id);
}, { dof: [] });

export const pointOnSegment = mark((seg: Segment, t: number, id?: string): Glider => {
  const tt = draftAt(id, 0, t);
  return traced(pointOnSegmentValue(seg, tt), id);
}, { dof: [1] });

export const pointOnLine = mark((geom: LineLike, s: number, id?: string): Glider => {
  const ss = draftAt(id, 0, s);
  return traced(pointOnLineValue(geom, ss), id);
}, { dof: [1] });

export const pointOnCircle = mark((c: Circle, ux: number, uy: number, id?: string): Glider => {
  const u = draftAt(id, 0, ux);
  const v = draftAt(id, 1, uy);
  return traced(pointOnCircleValue(c, u, v), id);
}, { dof: [1, 2] });

export function signedDist(p: Vec2, geom: LineLike): number {
  return signedDistValue(p, geom);
}

export const lineIntersection = mark((a: LineLike, b: LineLike, id?: string): Point => {
  const p = lineIntersectionValue(a, b);
  return traced({ kind: "point", x: p.x, y: p.y }, id);
}, { dof: [] });

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

export const profile = mark((cycle: readonly unknown[], id?: string): Profile => {
  return traced(profileValue(cycle), id);
}, { dof: [] });

export const roundOffset = mark((face: Profile, dist: number, id?: string): Profile => {
  const d = draftAt(id, 0, dist);
  if (!face || typeof face !== "object" || !isProfile(face)) return nanProfile();
  return traced(roundOffsetValue(face, d)[0] ?? nanProfile(), id);
}, { dof: [1] });

export type SliderOpts = {
  min?: number;
  max?: number;
  step?: number;
};

function snapEditNumber(raw: number, min: number, max: number, step: number): number {
  const clamped = Math.min(max, Math.max(min, raw));
  if (!(step > 0)) return clamped;
  return Math.round((clamped - min) / step) * step + min;
}

function tracedSlider(n: number, meta: Omit<SliderValue, "kind" | "n">, id: string | undefined): number {
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
    stack: captureUserStack(),
  };
  ctx.trace.push(node);
  return n;
}

export const slider = mark((n: number, opts?: SliderOpts, id?: string): number => {
  const raw = draftAt(id, 0, n);
  const min = opts?.min ?? Math.min(0, raw);
  const max = opts?.max ?? Math.max(Math.abs(raw) * 2, 1, min + 1);
  const step = opts?.step && opts.step > 0 ? opts.step : 0.01;
  const v = snapEditNumber(raw, min, max, step);
  return tracedSlider(v, { min, max, step }, id);
}, { dof: [0] });

/** Register a shared look. Pass the value to `paint`, or pass a spec object instead. */
export const style = mark((spec: Omit<FigureStyle, "kind"> = {}, id?: string): FigureStyle => {
  return traced(cloneStyle(spec), id);
}, { dof: [] });

/** Walk branded geom in `object` and record a paint. Look is a `style()` value or a spec object. */
export const paint = mark((object: unknown, look: FigureStyle | StyleSpec, id?: string): PaintValue => {
  const value: PaintValue = { kind: "paint", targets: collectPaintTargets(object), style: lookOf(look) };
  return traced(value, id);
}, { dof: [] });

export const constructors = {
  point,
  circle,
  segment,
  line,
  parallelLine,
  perpendicularLine,
  pointOnSegment,
  pointOnLine,
  pointOnCircle,
  lineIntersection,
  circleLineIntersection,
  circleCircleIntersection,
  slider,
  profile,
  roundOffset,
  style,
  paint,
} as const;
