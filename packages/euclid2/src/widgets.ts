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

export type AngleGizmo = {
  kind: "angle";
  index: number;
  origin: Vec2;
  /** Degrees, 0–360, CCW from +X. */
  deg: number;
  radius: number;
};

export type Gizmo = PointGizmo | DistanceGizmo | GliderGizmo | NumberGizmo | AngleGizmo;

const gizmos: Gizmo[] = [];
/** Live write-back values, keyed by the 2D scene that owns them. */
const overridesBySource = new Map<string, Map<number, number[]>>();
/** Last published frame per source — for withoutWidgets in another scene. */
const importedBySource = new Map<string, Map<number, number[]>>();
let nextIndex = 0;
let silent = 0;
let silentIndex = 0;
let activeSource = "";
let silentSource = "";

function overridesOf(source: string): Map<number, number[]> {
  let bag = overridesBySource.get(source);
  if (!bag) {
    bag = new Map();
    overridesBySource.set(source, bag);
  }
  return bag;
}

export function beginWidgetFrame(source = ""): void {
  activeSource = source;
  nextIndex = 0;
  gizmos.length = 0;
}

/**
 * Run edit* without gizmos or write-back indices.
 * Reads `publishWidgetOverrides(source)` from that 2D scene (e.g. plate → mill,
 * cylinder → rose, profile → rose), not the live map of the scene evaluating
 * now. Channels must match: two 2D editors otherwise collide on index 0.
 */
export function withoutWidgets<T>(fn: () => T, source = ""): T {
  silent += 1;
  const prevIndex = silentIndex;
  const prevSource = silentSource;
  silentIndex = 0;
  silentSource = source;
  try {
    return fn();
  } finally {
    silentIndex = prevIndex;
    silentSource = prevSource;
    silent -= 1;
  }
}

function takeSilentIndex(): number {
  const i = silentIndex;
  silentIndex += 1;
  return i;
}

export function setWidgetOverride(
  index: number,
  values: number[],
  source?: string,
): void {
  overridesOf(source ?? activeSource).set(index, values);
}

export function clearWidgetOverrides(source?: string): void {
  overridesOf(source ?? activeSource).clear();
}

/** Snapshot this source’s live widgets for silent readers (split mill, rose). */
export function publishWidgetOverrides(source?: string): void {
  const src = source ?? activeSource;
  const snap = new Map<number, number[]>();
  for (const [k, v] of overridesOf(src)) snap.set(k, [...v]);
  importedBySource.set(src, snap);
}

export function clearImportedOverrides(source?: string): void {
  if (source == null) importedBySource.clear();
  else importedBySource.delete(source);
}

function silentOverride(index: number): number[] | undefined {
  return importedBySource.get(silentSource)?.get(index);
}

function liveOverride(index: number): number[] | undefined {
  return overridesBySource.get(activeSource)?.get(index);
}

/** Copy of this frame’s gizmos. Callers must not keep the live array — a
 * second 2D editor’s beginWidgetFrame() clears it in place. */
export function getGizmos(): readonly Gizmo[] {
  return gizmos.slice();
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
  const o = liveOverride(index);
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
  const o = liveOverride(index);
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
  const o = liveOverride(index);
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
  const v = snapEditNumber(liveOverride(index)?.[0] ?? n, min, max, step);
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

export type AngleEditOpts = {
  /** Gizmo arm length. Default 1.5. */
  radius?: number;
};

function wrapDeg(deg: number): number {
  let d = deg % 360;
  if (d < 0) d += 360;
  return Math.round(d);
}

/**
 * World-space polar angle around `origin`.
 * The scene literal is degrees (1° snaps, readable source). Returns radians.
 */
export function editAngle(
  origin: Vec2,
  degrees: number,
  opts?: AngleEditOpts,
): number {
  const radius = Math.max(0.2, opts?.radius ?? 1.5);
  if (silent) {
    const o = silentOverride(takeSilentIndex());
    const deg = wrapDeg(o?.[0] ?? degrees);
    return (deg * Math.PI) / 180;
  }
  const index = takeIndex();
  const deg = wrapDeg(liveOverride(index)?.[0] ?? degrees);
  gizmos.push({
    kind: "angle",
    index,
    origin: { x: origin.x, y: origin.y },
    deg,
    radius,
  });
  return (deg * Math.PI) / 180;
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
    case "angle":
      return [g.deg];
  }
}
