import {
  allocId,
  captureUserStack,
  currentBind,
  point,
  resetIdentity,
  setGeomLiveReader,
  withoutDraw,
  isFiniteVec,
  type CallSite,
  type Drawable,
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
  bind?: string;
  style?: import("@design-scenes/geom").GeomStyle;
  __annotations__?: {
    file?: string;
    at?: [number, number];
    editable?: boolean;
    bind?: string;
  };
};

export type GizmoAt = { file: string; line: number; column: number };

/** `site` is the write target. `id` is `site#bind` or `site#k`. */
type Located = {
  site: string;
  id: string;
  bind?: string;
  at: GizmoAt;
  stack?: CallSite[];
  style?: import("@design-scenes/geom").GeomStyle;
};

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
  /** Degrees, −180…180, CCW from `from`. */
  deg: number;
  radius: number;
  /** Reference ray, world radians CCW from +X. */
  from: number;
  /** Same |deg|, reflected open direction across `from`. */
  mirror?: boolean;
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
  /** Stored literal, not mirrored. */
  d: number;
  /** Same |d|, opposite side of the carrier. */
  mirror?: boolean;
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

/** Point-sized grab targets — pick and paint these above lines and rings. */
export function gizmoIsPointLike(g: Gizmo): boolean {
  return (
    g.kind === "point" ||
    g.kind === "glider" ||
    g.kind === "lineGlider" ||
    g.kind === "vector" ||
    g.kind === "angle"
  );
}

const gizmos: Gizmo[] = [];
/** Live write-back values, keyed by the 2D scene that owns them. */
const overridesBySource = new Map<string, Map<string, number[]>>();
/** Last published frame per source — for withoutWidgets in another scene. */
const importedBySource = new Map<string, Map<string, number[]>>();
let silent = 0;
let activeSource = "";
let silentSource = "";

function locatedAt(
  file: string,
  line: number,
  column: number,
  stack?: CallSite[],
  style?: import("@design-scenes/geom").GeomStyle,
): Located {
  const site = `${file}:${line}:${column}`;
  const bind = currentBind();
  return {
    site,
    id: allocId(site, bind),
    ...(bind ? { bind } : {}),
    at: { file, line, column },
    stack,
    ...(style ? { style } : {}),
  };
}

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
  return locatedAt(file, line, column, captureUserStack(), opts?.style);
}

function readOverride(site: string | undefined): number[] | undefined {
  if (!site) return undefined;
  if (silent) return importedBySource.get(silentSource)?.get(site);
  return overridesBySource.get(activeSource)?.get(site);
}

export function beginWidgetFrame(source = ""): void {
  activeSource = source;
  gizmos.length = 0;
  resetIdentity();
  setGeomLiveReader((site) => {
    const key = `${site.file}:${site.line}:${site.column}`;
    if (silent) return importedBySource.get(silentSource)?.get(key);
    return overridesBySource.get(activeSource)?.get(key);
  });
}

/**
 * Run constructors and widgets without gizmos. Reads
 * `publishWidgetOverrides(source)` from that 2D scene (e.g. plate → mill),
 * not the live map of the scene evaluating now. Snapshot keys are
 * file:line:column.
 */
export function withoutWidgets<T>(fn: () => T, source = ""): T {
  silent += 1;
  const prevSource = silentSource;
  silentSource = source;
  try {
    return withoutDraw(fn);
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

function locatedFromGeom(geom: Drawable["geom"]): Located | null {
  if (!geom.site) return null;
  return {
    site: `${geom.site.file}:${geom.site.line}:${geom.site.column}`,
    id: geom.id,
    ...(geom.bind ? { bind: geom.bind } : {}),
    at: { file: geom.site.file, line: geom.site.line, column: geom.site.column },
    stack: geom.provenance.stack,
    ...(geom.style ? { style: geom.style } : {}),
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
      mirror: geom.offsetMirror,
    };
  }
  return null;
}

/** Handles for constructors the annotator marked editable. */
export function gizmosFromDrawables(drawables: readonly Drawable[]): Gizmo[] {
  if (silent) return [];
  const out: Gizmo[] = [];
  for (const d of drawables) {
    const g = d.geom;
    const located = locatedFromGeom(g);
    if (!located) continue;
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

/** Glider on a finite segment. `t` is in `[0, 1]`. */
export function pointOnSegment(lineSeg: Segment, t: number, site?: SiteOpts): Point {
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
export function pointOnLine(
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
export function vector(origin: Vec2, dx: number, dy: number, site?: SiteOpts): Vec2 {
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

export type AngleEditOpts = {
  /** Gizmo arm length. Default 1.5. */
  radius?: number;
  /** Reference ray in world radians (CCW from +X). Degrees are relative to this. */
  from?: number;
  /** Reflect open direction across `from` — same |degrees|, opposite sweep. */
  mirror?: boolean;
} & SiteOpts;

/** Signed degrees in (−180, 180]. */
export function wrapAngleDeg(deg: number): number {
  let d = ((((deg + 180) % 360) + 360) % 360) - 180;
  if (d === -180) return 180;
  return Math.round(d);
}

export function angleWorldRad(from: number, deg: number): number {
  return from + (deg * Math.PI) / 180;
}

/** World radians for the open leaf (after optional mirror). */
export function angleDisplayRad(from: number, deg: number, mirror = false): number {
  const forward = angleWorldRad(from, deg);
  return mirror ? 2 * from - forward : forward;
}

/**
 * Polar angle around `origin`. The scene literal is degrees from `opts.from`
 * (default +X). Returns world radians.
 */
export function angle(origin: Vec2, degrees: number, opts?: AngleEditOpts): number {
  const radius = Math.max(0.2, opts?.radius ?? 1.5);
  const from = opts?.from ?? 0;
  const mirror = opts?.mirror ?? false;
  const located = siteFrom(opts);
  const deg = wrapAngleDeg(readOverride(located?.site)?.[0] ?? degrees);
  if (!silent && located) {
    gizmos.push({
      kind: "angle",
      ...located,
      origin: { x: origin.x, y: origin.y },
      deg,
      radius,
      from,
      mirror,
    });
  }
  return angleDisplayRad(from, deg, mirror);
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
