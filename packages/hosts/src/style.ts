import type { InspectPatch, LineDash, ObjectStyle, StyleChannel } from "@design-scenes/shell";

import { commitStyle } from "./inspect";

export type DrawInk = {
  stroke?: string;
  width?: number;
  dash?: number[];
  fill?: string;
  pointSize?: number;
};

const DASH: Record<LineDash, number[]> = {
  solid: [],
  dashed: [8, 6],
  dotted: [2.5, 4],
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

export function dashPattern(dash: LineDash | undefined): number[] {
  return DASH[dash ?? "solid"];
}

export function drawInkFromStyle(style: ObjectStyle | undefined, channel: StyleChannel | null): DrawInk | undefined {
  if (!style || !channel) return undefined;
  if (channel === "point" && style.point) {
    return { fill: style.point.color, stroke: style.point.color, pointSize: style.point.size };
  }
  if (channel === "line" && style.line) {
    return {
      stroke: style.line.color,
      width: style.line.width,
      dash: dashPattern(style.line.dash),
    };
  }
  return undefined;
}

/** Three.js rest color / scale from constructor ink. */
export type RestInk = {
  color?: number;
  pointScale?: number;
  dashed?: boolean;
};

export function parseHex(hex: string): number | undefined {
  const s = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(s)) return undefined;
  const full = s.length === 3 ? [...s].map((c) => c + c).join("") : s;
  const n = parseInt(full, 16);
  return Number.isFinite(n) ? n : undefined;
}

export function restInkFromDraw(ink: DrawInk | undefined): RestInk | undefined {
  if (!ink) return undefined;
  return {
    color: ink.stroke ? parseHex(ink.stroke) : undefined,
    pointScale: ink.pointSize != null ? ink.pointSize / 3.5 : undefined,
    dashed: !!(ink.dash && ink.dash.length > 0),
  };
}

export type StyleSite = { file: string; line: number; column: number };

export function siteKey(at: StyleSite | undefined): string | null {
  if (!at) return null;
  return `${at.file}:${at.line}:${at.column}`;
}

type StyledGeom = { site?: StyleSite; style?: ObjectStyle };
type StyledGizmo = { at: StyleSite; style?: ObjectStyle };

/** Live-apply constructor ink to every drawable/gizmo that shares the write site. */
export function applyStyleAtSite(
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
      if (style) d.geom.style = style;
      else delete d.geom.style;
    }
  }
  for (const g of gizmos) {
    if (siteKey(g.at) === key) {
      if (style) g.style = style;
      else delete g.style;
    }
  }
}

export function inspectStylePatch(
  current: ObjectStyle | undefined,
  kind: string,
  at: { file: string; line: number; column: number } | undefined,
  onApply: (style: ObjectStyle | null) => void,
): InspectPatch {
  const styleChannel = styleChannelForKind(kind);
  if (!styleChannel) return { style: null, styleChannel: null, onStyleChange: undefined };
  return {
    style: current && (current.line || current.point) ? current : null,
    styleChannel,
    onStyleChange: (style: ObjectStyle | null) => {
      onApply(style);
      if (at) void commitStyle(at, style);
    },
  };
}
