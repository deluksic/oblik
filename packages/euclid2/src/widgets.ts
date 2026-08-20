import { point, type Line, type Point } from "@design-scenes/geom";
import type { Vec2 } from "@design-scenes/geom";
import { lerp } from "@design-scenes/geom";

export type SiteOpts = {
  id?: string;
  at?: [number, number];
};

export type GizmoAt = { line: number; column: number };

type Located = { site: string; at: GizmoAt };

export type PointGizmo = Located & {
  kind: "point";
  x: number;
  y: number;
};

export type DistanceGizmo = Located & {
  kind: "distance";
  origin: Vec2;
  d: number;
};

export type GliderGizmo = Located & {
  kind: "glider";
  a: Vec2;
  b: Vec2;
  t: number;
};

export type NumberGizmo = Located & {
  kind: "number";
  n: number;
  label: string;
  min: number;
  max: number;
  step: number;
};

export type AngleGizmo = Located & {
  kind: "angle";
  origin: Vec2;
  /** Degrees, 0–360, CCW from +X. */
  deg: number;
  radius: number;
};

export type VectorGizmo = Located & {
  kind: "vector";
  origin: Vec2;
  dx: number;
  dy: number;
};

export type Gizmo =
  | PointGizmo
  | DistanceGizmo
  | GliderGizmo
  | NumberGizmo
  | AngleGizmo
  | VectorGizmo;

const gizmos: Gizmo[] = [];
/** Live write-back values, keyed by the 2D scene that owns them. */
const overridesBySource = new Map<string, Map<string, number[]>>();
/** Last published frame per source — for withoutWidgets in another scene. */
const importedBySource = new Map<string, Map<string, number[]>>();
let silent = 0;
let activeSource = "";
let silentSource = "";

function overridesOf(source: string): Map<string, number[]> {
  let bag = overridesBySource.get(source);
  if (!bag) {
    bag = new Map();
    overridesBySource.set(source, bag);
  }
  return bag;
}

function siteFrom(opts?: SiteOpts): Located | null {
  if (!opts?.id || !opts.at || opts.at.length < 2) return null;
  const line = opts.at[0];
  const column = opts.at[1];
  if (typeof line !== "number" || typeof column !== "number") return null;
  return { site: opts.id, at: { line, column } };
}

function readOverride(id: string | undefined): number[] | undefined {
  if (!id) return undefined;
  if (silent) return importedBySource.get(silentSource)?.get(id);
  return overridesBySource.get(activeSource)?.get(id);
}

export function beginWidgetFrame(source = ""): void {
  activeSource = source;
  gizmos.length = 0;
}

/**
 * Run edit* without gizmos. Reads `publishWidgetOverrides(source)` from that
 * 2D scene (e.g. plate → mill, cylinder → rose, profile → rose), not the live
 * map of the scene evaluating now. Overlay is keyed by the compile-time UUID
 * on each CallExpression.
 */
export function withoutWidgets<T>(fn: () => T, source = ""): T {
  silent += 1;
  const prevSource = silentSource;
  silentSource = source;
  try {
    return fn();
  } finally {
    silentSource = prevSource;
    silent -= 1;
  }
}

export function setWidgetOverride(
  site: string,
  values: number[],
  source?: string,
): void {
  overridesOf(source ?? activeSource).set(site, values);
}

export function clearWidgetOverrides(source?: string): void {
  overridesOf(source ?? activeSource).clear();
}

/** Snapshot this source’s live widgets for silent readers (split mill, rose). */
export function publishWidgetOverrides(source?: string): void {
  const src = source ?? activeSource;
  const snap = new Map<string, number[]>();
  for (const [k, v] of overridesOf(src)) snap.set(k, [...v]);
  importedBySource.set(src, snap);
}

export function clearImportedOverrides(source?: string): void {
  if (source == null) importedBySource.clear();
  else importedBySource.delete(source);
}

/** Copy of this frame’s gizmos. Callers must not keep the live array — a
 * second 2D editor’s beginWidgetFrame() clears it in place. */
export function getGizmos(): readonly Gizmo[] {
  return gizmos.slice();
}

export function editPoint(x: number, y: number, site?: SiteOpts): Point {
  const o = readOverride(site?.id);
  const px = o?.[0] ?? x;
  const py = o?.[1] ?? y;
  const located = siteFrom(site);
  if (!silent && located) {
    gizmos.push({ kind: "point", ...located, x: px, y: py });
  }
  return point(px, py);
}

export function editDistanceToPoint(
  origin: Vec2,
  d: number,
  site?: SiteOpts,
): number {
  const o = readOverride(site?.id);
  const dist = o?.[0] ?? d;
  const located = siteFrom(site);
  if (!silent && located) {
    gizmos.push({
      kind: "distance",
      ...located,
      origin: { x: origin.x, y: origin.y },
      d: dist,
    });
  }
  return dist;
}

export function editPointOnLine(
  lineSeg: Line,
  t: number,
  site?: SiteOpts,
): Point {
  const o = readOverride(site?.id);
  const tt = Math.min(1, Math.max(0, o?.[0] ?? t));
  const located = siteFrom(site);
  if (!silent && located) {
    gizmos.push({
      kind: "glider",
      ...located,
      a: lineSeg.a,
      b: lineSeg.b,
      t: tt,
    });
  }
  const p = lerp(lineSeg.a, lineSeg.b, tt);
  return point(p.x, p.y);
}

/**
 * Offset from `origin`. Gizmo is the coral handle at origin+(dx,dy).
 * Drag writes dx, dy; origin is geometry, not a write target.
 */
export function editVector(
  origin: Vec2,
  dx: number,
  dy: number,
  site?: SiteOpts,
): Vec2 {
  const o = readOverride(site?.id);
  const vx = o?.[0] ?? dx;
  const vy = o?.[1] ?? dy;
  const located = siteFrom(site);
  if (!silent && located) {
    gizmos.push({
      kind: "vector",
      ...located,
      origin: { x: origin.x, y: origin.y },
      dx: vx,
      dy: vy,
    });
  }
  return { x: vx, y: vy };
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
} & SiteOpts;

/** Screen-space titled slider. For counts and other non-spatial parameters. */
export function editNumber(n: number, opts: NumberEditOpts): number {
  const min = opts.min ?? 0;
  const max = opts.max ?? Math.max(min + 1, n);
  const step = opts.step && opts.step > 0 ? opts.step : 1;
  const v = snapEditNumber(readOverride(opts.id)?.[0] ?? n, min, max, step);
  const located = siteFrom(opts);
  if (!silent && located) {
    gizmos.push({
      kind: "number",
      ...located,
      n: v,
      label: opts.label,
      min,
      max,
      step,
    });
  }
  return v;
}

export type AngleEditOpts = {
  /** Gizmo arm length. Default 1.5. */
  radius?: number;
} & SiteOpts;

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
  const deg = wrapDeg(readOverride(opts?.id)?.[0] ?? degrees);
  const located = siteFrom(opts);
  if (!silent && located) {
    gizmos.push({
      kind: "angle",
      ...located,
      origin: { x: origin.x, y: origin.y },
      deg,
      radius,
    });
  }
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
    case "vector":
      return [g.dx, g.dy];
  }
}
