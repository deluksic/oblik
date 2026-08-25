/** Euclid2 paint deviations. Discriminated by the same `kind` as the tape, never `{ point, line }`. */

export type StyleKind =
  | "point"
  | "gliderSegment"
  | "gliderLine"
  | "gliderCircle"
  | "segment"
  | "line"
  | "parallelLine"
  | "circle"
  | "slider";

type Hidden = { hidden?: boolean };
type Stroke = { stroke?: string };
type Fill = { fill?: string };
type Dash = { dash?: boolean };

/** Points and gliders share fill. */
export type MarkStyle = {
  kind: "point" | "gliderSegment" | "gliderLine" | "gliderCircle";
} & Hidden &
  Fill;

/** Segments and lines share stroke + dash. */
export type StrokeStyle = {
  kind: "segment" | "line" | "parallelLine";
} & Hidden &
  Stroke &
  Dash;

export type CircleStyle = { kind: "circle" } & Hidden & Stroke & Fill & Dash;
export type SliderStyle = { kind: "slider" } & Hidden;

export type NodeStyle = MarkStyle | StrokeStyle | CircleStyle | SliderStyle;

export type SheetEntry = { style: NodeStyle };
export type StyleSheet = Record<string, SheetEntry>;

export type StyleMismatch = {
  id: string;
  kind: string;
  expected?: StyleKind;
};

const STYLE_KINDS = new Set<string>([
  "point",
  "gliderSegment",
  "gliderLine",
  "gliderCircle",
  "segment",
  "line",
  "parallelLine",
  "circle",
  "slider",
]);

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function isStyleKind(value: string): value is StyleKind {
  return STYLE_KINDS.has(value);
}

export function isHexColor(value: string): boolean {
  return HEX.test(value);
}

function readHex(raw: unknown): string | undefined {
  if (typeof raw !== "string" || !isHexColor(raw)) return undefined;
  return raw;
}

function readBool(raw: unknown): boolean | undefined {
  return typeof raw === "boolean" ? raw : undefined;
}

function parseNodeStyle(raw: unknown): NodeStyle | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const rec = raw as Record<string, unknown>;
  if (typeof rec.kind !== "string" || !isStyleKind(rec.kind)) return null;
  const hidden = readBool(rec.hidden);
  const stroke = readHex(rec.stroke);
  const fill = readHex(rec.fill);
  const dash = readBool(rec.dash);
  switch (rec.kind) {
    case "point":
    case "gliderSegment":
    case "gliderLine":
    case "gliderCircle":
      return { kind: rec.kind, ...(hidden ? { hidden } : {}), ...(fill ? { fill } : {}) };
    case "segment":
    case "line":
    case "parallelLine":
      return {
        kind: rec.kind,
        ...(hidden ? { hidden } : {}),
        ...(stroke ? { stroke } : {}),
        ...(dash ? { dash } : {}),
      };
    case "circle":
      return {
        kind: "circle",
        ...(hidden ? { hidden } : {}),
        ...(stroke ? { stroke } : {}),
        ...(fill ? { fill } : {}),
        ...(dash ? { dash } : {}),
      };
    case "slider":
      return { kind: "slider", ...(hidden ? { hidden } : {}) };
  }
}

export function parseSheetEntry(raw: unknown): SheetEntry | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const rec = raw as Record<string, unknown>;
  if (isChannelBag(rec.style)) return null;
  const style = parseNodeStyle(rec.style);
  if (!style) return null;
  return { style };
}

/** Reject P5’s `{ point, line }` bag even if a `kind` field is present. */
function isChannelBag(style: unknown): boolean {
  if (!style || typeof style !== "object" || Array.isArray(style)) return false;
  return "point" in style || "line" in style;
}

export function parseStyleSheet(raw: unknown): StyleSheet {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: StyleSheet = {};
  for (const [id, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (!id || !entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const rec = entry as Record<string, unknown>;
    if (isChannelBag(rec.style)) continue;
    const parsed = parseSheetEntry(entry);
    if (parsed) out[id] = parsed;
  }
  return out;
}

export function styleHasDeviation(style: NodeStyle): boolean {
  if (style.hidden === true) return true;
  if ("stroke" in style && style.stroke) return true;
  if ("fill" in style && style.fill) return true;
  if ("dash" in style && style.dash === true) return true;
  return false;
}

export function pruneSheet(sheet: StyleSheet): StyleSheet {
  const out: StyleSheet = {};
  for (const [id, entry] of Object.entries(sheet)) {
    if (styleHasDeviation(entry.style)) out[id] = { style: entry.style };
  }
  return out;
}

export function patchStyleSheet(sheet: StyleSheet, id: string, style: NodeStyle | null): StyleSheet {
  const next = { ...sheet };
  if (style == null || !styleHasDeviation(style)) delete next[id];
  else next[id] = { style };
  return pruneSheet(next);
}

export function matchedStyle(sheet: StyleSheet, id: string, kind: string): NodeStyle | undefined {
  const entry = sheet[id];
  if (!entry) return undefined;
  if (entry.style.kind !== kind) return undefined;
  return entry.style;
}

export function isStyleVisible(style: NodeStyle | undefined): boolean {
  return style?.hidden !== true;
}

export function findStyleMismatches(
  sheet: StyleSheet,
  annotations: Record<string, { kind: string }>,
): StyleMismatch[] {
  const out: StyleMismatch[] = [];
  for (const [id, entry] of Object.entries(sheet)) {
    const anno = annotations[id];
    if (!anno) {
      out.push({ id, kind: entry.style.kind });
      continue;
    }
    if (entry.style.kind !== anno.kind) {
      out.push({
        id,
        kind: entry.style.kind,
        expected: isStyleKind(anno.kind) ? anno.kind : undefined,
      });
    }
  }
  return out.toSorted((a, b) => a.id.localeCompare(b.id));
}

export function defaultStyle(kind: StyleKind): NodeStyle {
  return { kind } as NodeStyle;
}

export function setStyleHidden(style: NodeStyle, hidden: boolean): NodeStyle {
  const next = { ...style };
  if (hidden) next.hidden = true;
  else delete next.hidden;
  return next;
}

export function setStyleStroke(style: NodeStyle, stroke: string | undefined): NodeStyle {
  if (!styleTakesStroke(style)) return style;
  const next = { ...style };
  if (stroke) next.stroke = stroke;
  else delete next.stroke;
  return next;
}

export function setStyleFill(style: NodeStyle, fill: string | undefined): NodeStyle {
  if (!styleTakesFill(style)) return style;
  const next = { ...style };
  if (fill) next.fill = fill;
  else delete next.fill;
  return next;
}

export function setStyleDash(style: NodeStyle, dash: boolean): NodeStyle {
  if (!styleTakesDash(style)) return style;
  const next = { ...style };
  if (dash) next.dash = true;
  else delete next.dash;
  return next;
}

export function styleTakesFill(style: NodeStyle): boolean {
  return (
    style.kind === "point" ||
    style.kind === "gliderSegment" ||
    style.kind === "gliderLine" ||
    style.kind === "gliderCircle" ||
    style.kind === "circle"
  );
}

export function styleTakesStroke(style: NodeStyle): boolean {
  return style.kind === "segment" || style.kind === "line" || style.kind === "parallelLine" || style.kind === "circle";
}

export function styleTakesDash(style: NodeStyle): boolean {
  return styleTakesStroke(style);
}

export function svgPaint(style: NodeStyle | undefined): { stroke?: string; fill?: string; dash?: string } {
  if (!style) return {};
  return {
    ...("stroke" in style && style.stroke ? { stroke: style.stroke } : {}),
    ...("fill" in style && style.fill ? { fill: style.fill } : {}),
    ...("dash" in style && style.dash ? { dash: "6 4" } : {}),
  };
}
