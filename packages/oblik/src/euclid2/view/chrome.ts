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
};

export type ChromeMetrics = {
  gapPx: number;
  selectRingPx: number;
  hoverRingPx: number;
};

export const DEFAULT_CHROME_METRICS: ChromeMetrics = {
  gapPx: 1,
  selectRingPx: 1.5,
  hoverRingPx: 1,
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
  const ring = opts.selected ? metrics.selectRingPx : metrics.hoverRingPx;
  const gap = w + 2 * metrics.gapPx;
  return [
    { kind: "outline", width: gap + 2 * ring },
    { kind: "knockout", width: gap },
    { kind: "paint", width: w },
  ];
}
