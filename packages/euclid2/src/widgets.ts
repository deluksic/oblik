import {
  offsetLine,
  point,
  setGeomLiveReader,
  withoutDraw,
  isFiniteVec,
  type Drawable,
  type LineLike,
  type Point,
  type Segment,
} from "@design-scenes/geom";
import { handleOwnsInk } from "./ink";
import type { Vec2 } from "@design-scenes/geom";
import { lerp } from "@design-scenes/geom";

export type SiteOpts = {
  file?: string;
  at?: [number, number];
  editable?: boolean;
  __annotations__?: {
    file?: string;
    at?: [number, number];
    editable?: boolean;
  };
};

export type GizmoAt = { file: string; line: number; column: number };

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

export type LineGliderGizmo = Located & {
  kind: "lineGlider";
  origin: Vec2;
  /** Unit direction. */
  direction: Vec2;
  /** Signed distance along direction, world units. */
  s: number;
  min?: number;
  max?: number;
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

export type OffsetGizmo = Located & {
  kind: "offset";
  origin: Vec2;
  direction: Vec2;
  d: number;
};

export type Gizmo =
  | PointGizmo
  | DistanceGizmo
  | GliderGizmo
  | LineGliderGizmo
  | NumberGizmo
  | AngleGizmo
  | VectorGizmo
  | OffsetGizmo;

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
  const nested = opts?.__annotations__;
  const file = nested?.file ?? opts?.file;
  const at = nested?.at ?? opts?.at;
  if (!file || !at || at.length < 2) return null;
  const line = at[0];
  const column = at[1];
  if (typeof line !== "number" || typeof column !== "number") return null;
  return {
    site: `${file}:${line}:${column}`,
    at: { file, line, column },
  };
}

function readOverride(site: string | undefined): number[] | undefined {
  if (!site) return undefined;
  if (silent) return importedBySource.get(silentSource)?.get(site);
  return overridesBySource.get(activeSource)?.get(site);
}

export function beginWidgetFrame(source = ""): void {
  activeSource = source;
  gizmos.length = 0;
  setGeomLiveReader((site) => {
    const key = `${site.file}:${site.line}:${site.column}`;
    if (silent) return importedBySource.get(silentSource)?.get(key);
    return overridesBySource.get(activeSource)?.get(key);
  });
}

/**
 * Run edit* without gizmos. Reads `publishWidgetOverrides(source)` from that
 * 2D scene (e.g. plate → mill, cylinder → rose, profile → rose), not the live
 * map of the scene evaluating now. Snapshot keys are file:line:column.
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

export function setWidgetOverride(site: string, values: number[], source?: string): void {
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

function locatedFromGeomSite(site: { file: string; line: number; column: number }): Located {
  return {
    site: `${site.file}:${site.line}:${site.column}`,
    at: { file: site.file, line: site.line, column: site.column },
  };
}

/**
 * Kind table: editable geom → gizmo. Point handle, radius ring, offset overlay.
 * Line / segment have no DOF here (drag the endpoints).
 */
export function gizmoForEditableGeom(
  geom: Drawable["geom"],
  located: Located,
  override: number[] | undefined,
): Gizmo | null {
  if (!handleOwnsInk(geom) || !geom.site) return null;
  if (geom.kind === "point") {
    const x = override?.[0] ?? geom.x;
    const y = override?.[1] ?? geom.y;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { kind: "point", ...located, x, y };
  }
  if (geom.kind === "circle") {
    const d = override?.[0] ?? geom.radius;
    if (!isFiniteVec(geom.center) || !Number.isFinite(d)) return null;
    return {
      kind: "distance",
      ...located,
      origin: { x: geom.center.x, y: geom.center.y },
      d,
    };
  }
  if (geom.kind === "line" && geom.offsetDistance != null) {
    const dd = override?.[0] ?? geom.offsetDistance;
    if (!isFiniteVec(geom.origin) || !isFiniteVec(geom.direction) || !Number.isFinite(dd)) {
      return null;
    }
    return {
      kind: "offset",
      ...located,
      origin: geom.origin,
      direction: geom.direction,
      d: dd,
    };
  }
  return null;
}

/** Handles for constructors the annotator marked editable. */
export function gizmosFromDrawables(drawables: readonly Drawable[]): Gizmo[] {
  const out: Gizmo[] = [];
  for (const d of drawables) {
    const g = d.geom;
    if (!g.site) continue;
    const located = locatedFromGeomSite(g.site);
    const giz = gizmoForEditableGeom(g, located, readOverride(located.site));
    if (giz) out.push(giz);
  }
  return out;
}

/** Shared length owned by this call. Length-slot tools reuse the binding name. */
export type SliderOpts = {
  label?: string;
  min?: number;
  max?: number;
  step?: number;
} & SiteOpts;

export function slider(n: number, opts?: SliderOpts): number {
  const located = siteFrom(opts);
  const raw = located ? (readOverride(located.site)?.[0] ?? n) : n;
  const min = opts?.min ?? Math.min(0, raw);
  const max = opts?.max ?? Math.max(Math.abs(raw) * 2, 1, min + 1);
  const step = opts?.step && opts.step > 0 ? opts.step : 0.01;
  const v = snapEditNumber(raw, min, max, step);
  if (!silent && located && Number.isFinite(v)) {
    gizmos.push({
      kind: "number",
      ...located,
      n: v,
      label: opts?.label?.trim() || "value",
      min,
      max,
      step,
    });
  }
  return v;
}

export function editPoint(x: number, y: number, site?: SiteOpts): Point {
  const located = siteFrom(site);
  const o = readOverride(located?.site);
  const px = o?.[0] ?? x;
  const py = o?.[1] ?? y;
  if (!silent && located) {
    gizmos.push({ kind: "point", ...located, x: px, y: py });
  }
  return withoutDraw(() => point(px, py));
}

export function editDistanceToPoint(origin: Vec2, d: number, site?: SiteOpts): number {
  const located = siteFrom(site);
  const o = readOverride(located?.site);
  const dist = o?.[0] ?? d;
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

/** Glider on a finite segment. `t` is in `[0, 1]`. */
export function editPointOnSegment(lineSeg: Segment, t: number, site?: SiteOpts): Point {
  const located = siteFrom(site);
  const o = readOverride(located?.site);
  const tt = Math.min(1, Math.max(0, o?.[0] ?? t));
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
  return withoutDraw(() => point(p.x, p.y));
}

export type LineEditOpts = SiteOpts & { min?: number; max?: number };

function unitDir(direction: Vec2): Vec2 {
  const len = Math.hypot(direction.x, direction.y);
  if (len < 1e-12) return { x: 1, y: 0 };
  return { x: direction.x / len, y: direction.y / len };
}

/**
 * Glider on an infinite line through `origin` along `direction`.
 * `s` is signed distance in world units (not 0–1). Returns the absolute point.
 */
export function editPointOnLine(
  origin: Vec2,
  direction: Vec2,
  s: number,
  opts?: LineEditOpts,
): Point {
  const located = siteFrom(opts);
  const o = readOverride(located?.site);
  let ss = o?.[0] ?? s;
  if (opts?.min != null) ss = Math.max(opts.min, ss);
  if (opts?.max != null) ss = Math.min(opts.max, ss);
  const dir = unitDir(direction);
  if (!silent && located) {
    gizmos.push({
      kind: "lineGlider",
      ...located,
      origin: { x: origin.x, y: origin.y },
      direction: dir,
      s: ss,
      min: opts?.min,
      max: opts?.max,
    });
  }
  return withoutDraw(() => point(origin.x + dir.x * ss, origin.y + dir.y * ss));
}

/**
 * Offset from `origin`. Widget is the handle at origin+(dx,dy).
 * Drag writes dx, dy; origin is geometry, not a write target.
 */
export function editVector(origin: Vec2, dx: number, dy: number, site?: SiteOpts): Vec2 {
  const located = siteFrom(site);
  const o = readOverride(located?.site);
  const vx = o?.[0] ?? dx;
  const vy = o?.[1] ?? dy;
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

export function snapEditNumber(n: number, min: number, max: number, step: number): number {
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
  const located = siteFrom(opts);
  const v = snapEditNumber(readOverride(located?.site)?.[0] ?? n, min, max, step);
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
export function editAngle(origin: Vec2, degrees: number, opts?: AngleEditOpts): number {
  const radius = Math.max(0.2, opts?.radius ?? 1.5);
  const located = siteFrom(opts);
  const deg = wrapDeg(readOverride(located?.site)?.[0] ?? degrees);
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

/**
 * Signed offset distance from a segment or infinite line.
 * Gizmo is an overlay along the offset line.
 */
export function editOffsetFromLine(geom: LineLike, d: number, site?: SiteOpts): number {
  const located = siteFrom(site);
  const o = readOverride(located?.site);
  const dd = o?.[0] ?? d;
  const off = withoutDraw(() => offsetLine(geom, dd));
  if (!silent && located) {
    gizmos.push({
      kind: "offset",
      ...located,
      origin: off.line.origin,
      direction: off.line.direction,
      d: dd,
    });
  }
  return dd;
}

export function gizmoValues(g: Gizmo): number[] {
  switch (g.kind) {
    case "point":
      return [g.x, g.y];
    case "distance":
      return [g.d];
    case "glider":
      return [g.t];
    case "lineGlider":
      return [g.s];
    case "number":
      return [g.n];
    case "angle":
      return [g.deg];
    case "vector":
      return [g.dx, g.dy];
    case "offset":
      return [g.d];
  }
}
