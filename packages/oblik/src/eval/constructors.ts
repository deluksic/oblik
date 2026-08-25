import {
  circleCircleIntersectionValue,
  circleLineIntersectionValue,
  dist as distVec,
  isFiniteVec,
  lineIntersectionValue,
  parallelLineValue,
  perpendicularLineValue,
  signedDist as signedDistValue,
  type Branch,
  type Circle,
  type Geom,
  type Line,
  type LineLike,
  type ParallelLine,
  type Point,
  type Segment,
  type Vec2,
} from "../geom";
import { brand, currentEval, type SliderValue, type TraceNode } from "./context";
import { $site, type SiteSpec } from "./site";
import { captureUserStack } from "./stack";

function draftAt(id: string | undefined, i: number, fallback: number): number {
  if (!id) return fallback;
  const row = currentEval()?.draft.get(id);
  const v = row?.[i];
  return v != null && Number.isFinite(v) ? v : fallback;
}

function traced<T extends Geom>(value: T, id: string | undefined): T {
  const ctx = currentEval();
  if (!ctx || !id) return value;
  if (!isFiniteValue(value)) return value;
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
    module: ctx.module ?? anno?.file,
    stack: captureUserStack(),
  };
  ctx.trace.push(node);
  return brand(value, node);
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
    default:
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
    module: ctx.module ?? anno?.file,
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

export const constructors = {
  point,
  circle,
  segment,
  line,
  parallelLine,
  perpendicularLine,
  lineIntersection,
  circleLineIntersection,
  circleCircleIntersection,
  slider,
} as const;
