import { nodeOf, type TraceNode } from "./context";
import type { Geom } from "../geom";

export type FigurePointMark = "dot" | "open" | "none";

export type FigureStyle = {
  kind: "style";
  stroke?: string;
  fill?: string;
  width?: number;
  dash?: readonly number[];
  point?: FigurePointMark;
};

export type StyleSpec = Omit<FigureStyle, "kind">;

export type PaintTarget = { id: string; occ: number };

export type PaintValue = {
  kind: "paint";
  targets: PaintTarget[];
  style: FigureStyle;
};

export function isStyle(value: unknown): value is FigureStyle {
  return !!value && typeof value === "object" && (value as FigureStyle).kind === "style";
}

/** A `style()` value or a plain look bag. Not geom. */
export function isLook(value: unknown): value is FigureStyle | StyleSpec {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const kind = (value as { kind?: unknown }).kind;
  return kind == null || kind === "style";
}

export function lookOf(value: unknown): FigureStyle {
  if (!isLook(value)) throw new Error("paint needs a look object or a style()");
  return cloneStyle(value);
}

export function isPaint(value: unknown): value is PaintValue {
  return !!value && typeof value === "object" && (value as PaintValue).kind === "paint";
}

export function paintKey(id: string, occ: number): string {
  return `${id}:${occ}`;
}

const GEOM_KINDS = new Set([
  "point",
  "segment",
  "line",
  "circle",
  "parallelLine",
  "profile",
  "gliderSegment",
  "gliderLine",
  "gliderCircle",
]);

export function isGeomKind(kind: string): boolean {
  return GEOM_KINDS.has(kind);
}

function walkPainted(value: unknown, visit: (n: TraceNode) => void, seen: Set<object>): void {
  if (!value || typeof value !== "object") return;
  const obj = value as object;
  if (seen.has(obj)) return;
  seen.add(obj);
  if (isStyle(value) || isPaint(value)) return;
  const n = nodeOf(value);
  if (n) {
    if (isGeomKind(n.kind)) visit(n);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) walkPainted(item, visit, seen);
    return;
  }
  for (const item of Object.values(value as Record<string, unknown>)) {
    walkPainted(item, visit, seen);
  }
}

/** Branded geom inside `object` (a bag is fine). Last occurrence of an id:occ wins. */
export function collectPaintTargets(object: unknown): PaintTarget[] {
  const byKey = new Map<string, PaintTarget>();
  walkPainted(
    object,
    (n) => {
      byKey.set(paintKey(n.id, n.occ), { id: n.id, occ: n.occ });
    },
    new Set(),
  );
  return [...byKey.values()];
}

/** Topmost style per geom (last paint in tape order). */
export function paintsFromTrace(trace: readonly TraceNode[]): Map<string, FigureStyle> {
  const out = new Map<string, FigureStyle>();
  for (const n of trace) {
    if (n.value.kind !== "paint") continue;
    const p = n.value as PaintValue;
    for (const t of p.targets) out.set(paintKey(t.id, t.occ), p.style);
  }
  return out;
}

export type PaintStroke = {
  paint: TraceNode;
  geom: TraceNode;
  style: FigureStyle;
};

/** Every paint×target in tape order (later on top). */
export function paintStrokesFromTrace(trace: readonly TraceNode[]): PaintStroke[] {
  const geom = new Map<string, TraceNode>();
  for (const n of trace) {
    if (n.value.kind === "style" || n.value.kind === "paint" || n.value.kind === "slider") continue;
    geom.set(paintKey(n.id, n.occ), n);
  }
  const out: PaintStroke[] = [];
  for (const n of trace) {
    if (n.value.kind !== "paint") continue;
    const p = n.value as PaintValue;
    for (const t of p.targets) {
      const g = geom.get(paintKey(t.id, t.occ));
      if (g) out.push({ paint: n, geom: g, style: p.style });
    }
  }
  return out;
}

export function paintsCovering(trace: readonly TraceNode[], geom: TraceNode): TraceNode[] {
  const key = paintKey(geom.id, geom.occ);
  return trace.filter((n) => {
    if (n.value.kind !== "paint") return false;
    return (n.value as PaintValue).targets.some((t) => paintKey(t.id, t.occ) === key);
  });
}

export function cloneStyle(spec: Omit<FigureStyle, "kind"> | FigureStyle): FigureStyle {
  const dash = spec.dash ? [...spec.dash] : undefined;
  const { stroke, fill, width, point } = spec;
  return {
    kind: "style",
    ...(stroke != null ? { stroke } : {}),
    ...(fill != null ? { fill } : {}),
    ...(width != null ? { width } : {}),
    ...(dash ? { dash } : {}),
    ...(point != null ? { point } : {}),
  };
}

export type { Geom };
