import type { LineDash, LineStyle, ObjectStyle, PointStyle } from "@/types";
import { DEFAULT_LINE_STYLE, DEFAULT_POINT_STYLE } from "@/types";

export type ColorPresetId = "default" | "red" | "blue" | "green" | "orange" | "custom";
export type SizePresetId = "small" | "normal" | "wide";

export const COLOR_PRESETS: readonly {
  id: ColorPresetId;
  label: string;
  hex?: string;
}[] = [
  { id: "default", label: "Default" },
  { id: "red", hex: "#e24b4b", label: "Red" },
  { id: "blue", hex: "#4a8fd9", label: "Blue" },
  { id: "green", hex: "#3caf73", label: "Green" },
  { id: "orange", hex: "#e8876a", label: "Orange" },
  { id: "custom", label: "Custom" },
];

export const LINE_WIDTH_PRESETS: readonly { id: SizePresetId; width: number; label: string }[] = [
  { id: "small", width: 0.75, label: "Small" },
  { id: "normal", width: DEFAULT_LINE_STYLE.width ?? 1.5, label: "Normal" },
  { id: "wide", width: 3.5, label: "Wide" },
];

export const POINT_SIZE_PRESETS: readonly { id: SizePresetId; size: number; label: string }[] = [
  { id: "small", size: 2.5, label: "Small" },
  { id: "normal", size: DEFAULT_POINT_STYLE.size ?? 3.5, label: "Normal" },
  { id: "wide", size: 7, label: "Wide" },
];

export const DASH_PRESETS: readonly { id: LineDash; label: string }[] = [
  { id: "solid", label: "Solid" },
  { id: "dashed", label: "Dashed" },
  { id: "dotted", label: "Dotted" },
];

const DASH_BASE: Record<LineDash, readonly number[]> = {
  solid: [],
  dashed: [8, 6],
  dotted: [2.5, 4],
};

/** Canvas dash segments at {@link DEFAULT_LINE_STYLE.width}; gap grows faster on wide strokes. */
export function dashPattern(dash: LineDash | undefined, width = DEFAULT_LINE_STYLE.width ?? 1.5): number[] {
  const base = DASH_BASE[dash ?? "solid"];
  if (base.length === 0) return [];
  const ref = DEFAULT_LINE_STYLE.width ?? 1.5;
  if (Math.abs(width - ref) < 1e-6) return [...base];

  const scale = width / ref;
  const gapBoost = scale > 1 ? Math.sqrt(scale) : 1;
  return base.map((seg, i) => {
    const scaled = seg * scale;
    return i % 2 === 1 ? scaled * gapBoost : scaled;
  });
}

export const DEFAULT_SWATCH = DEFAULT_LINE_STYLE.color ?? "#d7d2c4";

export function normalizeHex(hex: string | undefined): string | undefined {
  if (hex == null) return undefined;
  const s = hex.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(s)) {
    return `#${[...s].map((c) => c + c).join("").toLowerCase()}`;
  }
  if (/^[0-9a-fA-F]{6}$/.test(s)) return `#${s.toLowerCase()}`;
  return undefined;
}

export function selectedColorId(color: string | undefined): ColorPresetId {
  const hex = normalizeHex(color);
  if (!hex) return "default";
  for (const preset of COLOR_PRESETS) {
    if (preset.hex && normalizeHex(preset.hex) === hex) return preset.id;
  }
  return "custom";
}

export function selectedLineWidthId(width: number | undefined): SizePresetId | null {
  if (width == null) return "normal";
  const hit = LINE_WIDTH_PRESETS.find((preset) => Math.abs(preset.width - width) < 0.01);
  return hit?.id ?? null;
}

export function selectedPointSizeId(size: number | undefined): SizePresetId | null {
  if (size == null) return "normal";
  const hit = POINT_SIZE_PRESETS.find((preset) => Math.abs(preset.size - size) < 0.01);
  return hit?.id ?? null;
}

export function selectedDash(dash: LineDash | undefined): LineDash {
  return dash ?? "solid";
}

export function colorValueForPreset(id: ColorPresetId): string | undefined {
  if (id === "default" || id === "custom") return undefined;
  return COLOR_PRESETS.find((preset) => preset.id === id)?.hex;
}

export function widthValueForPreset(id: SizePresetId): number {
  return LINE_WIDTH_PRESETS.find((preset) => preset.id === id)?.width ?? DEFAULT_LINE_STYLE.width ?? 1.5;
}

export function sizeValueForPreset(id: SizePresetId): number {
  return POINT_SIZE_PRESETS.find((preset) => preset.id === id)?.size ?? DEFAULT_POINT_STYLE.size ?? 3.5;
}

function isEmptyLine(line: LineStyle | undefined): boolean {
  return !line || (line.color == null && line.width == null && line.dash == null);
}

function isEmptyPoint(point: PointStyle | undefined): boolean {
  return !point || (point.color == null && point.size == null);
}

export function mergeLineStyle(stored: LineStyle | undefined, patch: Partial<LineStyle>): LineStyle | undefined {
  const next: LineStyle = { ...(stored ?? {}) };
  for (const key of ["color", "width", "dash"] as const) {
    if (!(key in patch)) continue;
    const value = patch[key];
    if (value === undefined) delete next[key];
    else next[key] = value;
  }
  return isEmptyLine(next) ? undefined : next;
}

export function mergePointStyle(stored: PointStyle | undefined, patch: Partial<PointStyle>): PointStyle | undefined {
  const next: PointStyle = { ...(stored ?? {}) };
  for (const key of ["color", "size"] as const) {
    if (!(key in patch)) continue;
    const value = patch[key];
    if (value === undefined) delete next[key];
    else next[key] = value;
  }
  return isEmptyPoint(next) ? undefined : next;
}

export function withStyleChannel(
  current: ObjectStyle | null | undefined,
  channel: "line",
  value: LineStyle | undefined,
): ObjectStyle | null;
export function withStyleChannel(
  current: ObjectStyle | null | undefined,
  channel: "point",
  value: PointStyle | undefined,
): ObjectStyle | null;
export function withStyleChannel(
  current: ObjectStyle | null | undefined,
  channel: "line" | "point",
  value: LineStyle | PointStyle | undefined,
): ObjectStyle | null {
  const next: ObjectStyle = { ...(current ?? {}) };
  if (value === undefined) delete next[channel];
  else next[channel] = value;
  if (isEmptyLine(next.line) && isEmptyPoint(next.point)) return null;
  return next;
}

export function dashValueForPreset(id: LineDash): LineDash | undefined {
  if (id === "solid") return undefined;
  return id;
}

export function pickerHex(color: string | undefined): string {
  return normalizeHex(color) ?? DEFAULT_SWATCH;
}
