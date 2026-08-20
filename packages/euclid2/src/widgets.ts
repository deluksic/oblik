import { point, type Line, type Point } from "@design-scenes/geom";
import type { Vec2 } from "@design-scenes/geom";
import { lerp } from "@design-scenes/geom";

export type PointGizmo = {
  kind: "point";
  index: number;
  x: number;
  y: number;
};

export type DistanceGizmo = {
  kind: "distance";
  index: number;
  origin: Vec2;
  d: number;
};

export type GliderGizmo = {
  kind: "glider";
  index: number;
  a: Vec2;
  b: Vec2;
  t: number;
};

export type NumberGizmo = {
  kind: "number";
  index: number;
  n: number;
  label: string;
  min: number;
  max: number;
  step: number;
};

export type Gizmo = PointGizmo | DistanceGizmo | GliderGizmo | NumberGizmo;

const gizmos: Gizmo[] = [];
const overrides = new Map<number, number[]>();
/** Last published non-silent frame — for withoutWidgets in another scene. */
const imported = new Map<number, number[]>();
let nextIndex = 0;
let silent = 0;
let silentIndex = 0;

export function beginWidgetFrame(): void {
  nextIndex = 0;
  gizmos.length = 0;
}

/**
 * Run edit* without gizmos or write-back indices.
 * Reads `publishWidgetOverrides()` from another scene (e.g. plate → mill),
 * not the live override map of the scene that is currently evaluating.
 * Nest sliders must not leak into plateLayout().
 */
export function withoutWidgets<T>(fn: () => T): T {
  silent += 1;
  const prev = silentIndex;
  silentIndex = 0;
  try {
    return fn();
  } finally {
    silentIndex = prev;
    silent -= 1;
  }
}

function takeSilentIndex(): number {
  const i = silentIndex;
  silentIndex += 1;
  return i;
}

export function setWidgetOverride(index: number, values: number[]): void {
  overrides.set(index, values);
}

export function clearWidgetOverrides(): void {
  overrides.clear();
}

/** Snapshot this frame’s live widgets for silent readers (split mill). */
export function publishWidgetOverrides(): void {
  imported.clear();
  for (const [k, v] of overrides) imported.set(k, [...v]);
}

export function clearImportedOverrides(): void {
  imported.clear();
}

function silentOverride(index: number): number[] | undefined {
  return imported.get(index);
}

export function getGizmos(): readonly Gizmo[] {
  return gizmos;
}

function takeIndex(): number {
  const i = nextIndex;
  nextIndex += 1;
  return i;
}

export function editPoint(x: number, y: number): Point {
  if (silent) {
    const o = silentOverride(takeSilentIndex());
    return point(o?.[0] ?? x, o?.[1] ?? y);
  }
  const index = takeIndex();
  const o = overrides.get(index);
  const px = o?.[0] ?? x;
  const py = o?.[1] ?? y;
  gizmos.push({ kind: "point", index, x: px, y: py });
  return point(px, py);
}

export function editDistanceToPoint(origin: Vec2, d: number): number {
  if (silent) {
    const o = silentOverride(takeSilentIndex());
    return o?.[0] ?? d;
  }
  const index = takeIndex();
  const o = overrides.get(index);
  const dist = o?.[0] ?? d;
  gizmos.push({
    kind: "distance",
    index,
    origin: { x: origin.x, y: origin.y },
    d: dist,
  });
  return dist;
}

export function editPointOnLine(lineSeg: Line, t: number): Point {
  if (silent) {
    const o = silentOverride(takeSilentIndex());
    const tt = Math.min(1, Math.max(0, o?.[0] ?? t));
    const p = lerp(lineSeg.a, lineSeg.b, tt);
    return point(p.x, p.y);
  }
  const index = takeIndex();
  const o = overrides.get(index);
  const tt = Math.min(1, Math.max(0, o?.[0] ?? t));
  gizmos.push({
    kind: "glider",
    index,
    a: lineSeg.a,
    b: lineSeg.b,
    t: tt,
  });
  const p = lerp(lineSeg.a, lineSeg.b, tt);
  return point(p.x, p.y);
}

export function snapEditNumber(
  n: number,
  min: number,
  max: number,
  step: number,
): number {
  const clamped = Math.min(max, Math.max(min, n));
  const k = Math.round(clamped / step) * step;
  const q = Math.round(k * 1000) / 1000;
  return Math.min(max, Math.max(min, q));
}

export type NumberEditOpts = {
  label: string;
  min?: number;
  max?: number;
  step?: number;
};

/** Screen-space titled slider. For counts and other non-spatial parameters. */
export function editNumber(n: number, opts: NumberEditOpts): number {
  const min = opts.min ?? 0;
  const max = opts.max ?? Math.max(min + 1, n);
  const step = opts.step && opts.step > 0 ? opts.step : 1;
  if (silent) {
    const o = silentOverride(takeSilentIndex());
    return snapEditNumber(o?.[0] ?? n, min, max, step);
  }
  const index = takeIndex();
  const v = snapEditNumber(overrides.get(index)?.[0] ?? n, min, max, step);
  gizmos.push({
    kind: "number",
    index,
    n: v,
    label: opts.label,
    min,
    max,
    step,
  });
  return v;
}

export function gizmoValues(g: Gizmo): number[] {
  switch (g.kind) {
    case "point":
      return [g.x, g.y];
    case "distance":
      return [g.d];
    case "glider":
      return [g.t];
    case "number":
      return [g.n];
  }
}
