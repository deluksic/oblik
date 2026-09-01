export const CONSTRUCTION_STROKE_PX = 1.5;

export type ChromeKind = "knockout" | "outline" | "paint";

export type ChromeLayer = {
  kind: ChromeKind;
  width: number;
};

export type ChromeOpts = {
  selected: boolean;
  hover: boolean;
  overlay: boolean;
  knockout: boolean;
  /** HUD / screen-space SVG where viewBox units are already CSS px. */
  screenSpace?: boolean;
};

export type ChromeMetrics = {
  gapPx: number;
  selectRingPx: number;
  hoverRingPx: number;
};

export const DEFAULT_CHROME_METRICS: ChromeMetrics = {
  gapPx: 4,
  selectRingPx: 2,
  hoverRingPx: 2,
};

/** CSS `stroke-width` for a chrome layer (logical px). */
export function layerStrokeWidth(layer: ChromeLayer): string {
  return `${layer.width}px`;
}

/** Drawn back to front: outline, knockout (paper gap), paint. Reads inward as paint → gap → ring. */
export function chromeLayers(
  paintWidth: number,
  opts: ChromeOpts,
  metrics: ChromeMetrics = DEFAULT_CHROME_METRICS,
): ChromeLayer[] {
  const w = paintWidth > 0 ? paintWidth : 1;
  if (!opts.overlay) return [{ kind: "paint", width: w }];
  if (!opts.selected && !opts.hover) return [];
  if (!opts.knockout) return [];
  const ringCss = opts.selected ? metrics.selectRingPx : metrics.hoverRingPx;
  const px = opts.screenSpace ? 1 : chromeDprScale();
  const gapBand = metrics.gapPx * px;
  const ringBand = ringCss * px;
  const gap = w + 2 * gapBand;
  return [
    { kind: "outline", width: gap + 2 * ringBand },
    { kind: "knockout", width: gap },
    { kind: "paint", width: w },
  ];
}

/** Scale CSS px to device px for world-space non-scaling strokes. */
export function chromeDprScale(): number {
  if (typeof window === "undefined") return 1;
  return window.devicePixelRatio || 1;
}
