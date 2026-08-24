import type { LineDash } from "@/types";
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

export function widthValueForPreset(id: SizePresetId): number | undefined {
  if (id === "normal") return undefined;
  return LINE_WIDTH_PRESETS.find((preset) => preset.id === id)?.width;
}

export function sizeValueForPreset(id: SizePresetId): number | undefined {
  if (id === "normal") return undefined;
  return POINT_SIZE_PRESETS.find((preset) => preset.id === id)?.size;
}

export function dashValueForPreset(id: LineDash): LineDash | undefined {
  if (id === "solid") return undefined;
  return id;
}

export function pickerHex(color: string | undefined): string {
  return normalizeHex(color) ?? DEFAULT_SWATCH;
}
