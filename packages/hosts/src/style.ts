import { dashPattern, type InspectPatch, type ObjectStyle, type StyleChannel } from "@design-scenes/shell";

import { commitStyle } from "./inspect";

export type DrawInk = {
  stroke?: string;
  width?: number;
  dash?: number[];
  fill?: string;
  pointSize?: number;
};

const POINT_KINDS = new Set([
  "point",
  "point3",
  "glider",
  "glider3",
  "lineGlider",
]);

const LINE_KINDS = new Set([
  "segment",
  "line",
  "circle",
  "arc",
  "polyline",
  "distance",
  "distance3",
  "offset",
  "vector",
  "angle",
  "segment3",
  "circle3",
]);

export function styleChannelForKind(kind: string): StyleChannel | null {
  if (POINT_KINDS.has(kind)) return "point";
  if (LINE_KINDS.has(kind)) return "line";
  return null;
}

export function hasStoredStyle(style: ObjectStyle | null | undefined): boolean {
  if (!style) return false;
  const line = style.line;
  const point = style.point;
  return !!(
    (line && (line.color != null || line.width != null || line.dash != null)) ||
    (point && (point.color != null || point.size != null))
  );
}

function drawLineInk(line: ObjectStyle["line"]): DrawInk | undefined {
  if (!line) return undefined;
  const ink: DrawInk = {};
  if (line.color != null) ink.stroke = line.color;
  if (line.width != null) ink.width = line.width;
  if (line.dash != null) ink.dash = dashPattern(line.dash, line.width ?? 1.5);
  return Object.keys(ink).length > 0 ? ink : undefined;
}

function drawPointInk(point: ObjectStyle["point"]): DrawInk | undefined {
  if (!point) return undefined;
  const ink: DrawInk = {};
  if (point.color != null) {
    ink.fill = point.color;
    ink.stroke = point.color;
  }
  if (point.size != null) ink.pointSize = point.size;
  return Object.keys(ink).length > 0 ? ink : undefined;
}

export function drawInkFromStyle(style: ObjectStyle | undefined, channel: StyleChannel | null): DrawInk | undefined {
  if (!style || !channel) return undefined;
  if (channel === "point") return drawPointInk(style.point);
  if (channel === "line") return drawLineInk(style.line);
  return undefined;
}

/** Three.js rest color / scale from constructor ink. */
export type RestInk = {
  color?: number;
  pointScale?: number;
  dashed?: boolean;
  dashSize?: number;
  gapSize?: number;
};

const REST_DASH_REF = { dash: 8, gap: 6, dashSize: 0.14, gapSize: 0.1 };

export function parseHex(hex: string): number | undefined {
  const s = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(s)) return undefined;
  const full = s.length === 3 ? [...s].map((c) => c + c).join("") : s;
  const n = parseInt(full, 16);
  return Number.isFinite(n) ? n : undefined;
}

export function restInkFromDraw(ink: DrawInk | undefined): RestInk | undefined {
  if (!ink) return undefined;
  const rest: RestInk = {
    color: ink.stroke ? parseHex(ink.stroke) : undefined,
    pointScale: ink.pointSize != null ? ink.pointSize / 3.5 : undefined,
    dashed: !!(ink.dash && ink.dash.length > 0),
  };
  if (ink.dash && ink.dash.length >= 2) {
    rest.dashSize = REST_DASH_REF.dashSize * (ink.dash[0] / REST_DASH_REF.dash);
    rest.gapSize = REST_DASH_REF.gapSize * (ink.dash[1] / REST_DASH_REF.gap);
  }
  return rest;
}

export type StyleSite = { file: string; line: number; column: number };

export function siteKey(at: StyleSite | undefined): string | null {
  if (!at) return null;
  return `${at.file}:${at.line}:${at.column}`;
}

type StyledGeom = { site?: StyleSite; style?: ObjectStyle };
type StyledGizmo = { at: StyleSite; style?: ObjectStyle };

const styleOverlays = new Map<string, { at: StyleSite; style: ObjectStyle | null }>();

export function rememberStyleOverlay(at: StyleSite, style: ObjectStyle | null): void {
  const key = siteKey(at);
  if (!key) return;
  styleOverlays.set(key, { at, style });
}

export function applyStyleOverlays(
  drawables: readonly { geom: StyledGeom }[],
  gizmos: readonly StyledGizmo[],
): void {
  for (const rec of styleOverlays.values()) {
    paintStyleAtSite(rec.at, rec.style, drawables, gizmos);
  }
}

export function clearStyleOverlaysForFile(file: string): void {
  const norm = file.replace(/\\/g, "/");
  const base = norm.split("/").pop() ?? norm;
  for (const [key, rec] of styleOverlays) {
    const f = rec.at.file.replace(/\\/g, "/");
    if (f === norm || f === base || f.endsWith(`/${base}`) || f.endsWith(`/${norm}`)) {
      styleOverlays.delete(key);
    }
  }
}

function paintStyleAtSite(
  at: StyleSite,
  style: ObjectStyle | null,
  drawables: readonly { geom: StyledGeom }[],
  gizmos: readonly StyledGizmo[],
): void {
  const key = siteKey(at);
  if (!key) return;
  for (const d of drawables) {
    const s = d.geom.site;
    if (s && siteKey(s) === key) {
      if (style && hasStoredStyle(style)) d.geom.style = style;
      else delete d.geom.style;
    }
  }
  for (const g of gizmos) {
    if (siteKey(g.at) === key) {
      if (style && hasStoredStyle(style)) g.style = style;
      else delete g.style;
    }
  }
}

/** Live-apply constructor ink to every drawable/gizmo that shares the write site. */
export function applyStyleAtSite(
  at: StyleSite,
  style: ObjectStyle | null,
  drawables: readonly { geom: StyledGeom }[],
  gizmos: readonly StyledGizmo[],
): void {
  rememberStyleOverlay(at, style);
  paintStyleAtSite(at, style, drawables, gizmos);
}

export function inspectStylePatch(
  current: ObjectStyle | undefined,
  kind: string,
  at: { file: string; line: number; column: number } | undefined,
  onApply: (style: ObjectStyle | null) => void,
  onCommitted?: () => void | Promise<void>,
): InspectPatch {
  const styleChannel = styleChannelForKind(kind);
  if (!styleChannel) return { style: null, styleChannel: null, onStyleChange: undefined };
  return {
    style: hasStoredStyle(current) ? current : null,
    styleChannel,
    onStyleChange: (style: ObjectStyle | null) => {
      onApply(style);
      if (at) {
        void commitStyle(at, style).then((err) => {
          if (!err) void onCommitted?.();
        });
      }
    },
  };
}
