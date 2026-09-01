export const CONSTRUCTION_STROKE_PX = 1.5;
export const POINT_STROKE_PX = 2;

export type ChromeKind = "knockout" | "outline" | "paint";
export type ChromeClip = "outside" | "inside";

export type ChromeLayer = {
  kind: ChromeKind;
  width: number;
  clip?: ChromeClip;
};

export type ChromeOpts = {
  selected: boolean;
  hover: boolean;
  overlay: boolean;
  knockout: boolean;
  /** Filled regions (profiles): boundary chrome only, no paint or inner knockout. */
  filled?: boolean;
  /** HUD / screen-space SVG where viewBox units are already CSS px. */
  screenSpace?: boolean;
};

export type ChromeMetrics = {
  gapPx: number;
  selectRingPx: number;
  hoverRingPx: number;
  /** Paper underlap on the inside of a closed path, in CSS px. */
  bleedPx: number;
};

export const DEFAULT_CHROME_METRICS: ChromeMetrics = {
  gapPx: 4,
  selectRingPx: 2,
  hoverRingPx: 2,
  bleedPx: 1,
};

/** CSS `stroke-width` for a chrome layer (logical px). */
export function layerStrokeWidth(layer: ChromeLayer): string {
  return `${layer.width}px`;
}

/**
 * Drawn back to front: outline, outer knockout, inner knockout, paint.
 * Outer knockout is paper in the gap; inner knockout is paper under the paint
 * and 1px into the interior so neighbor edges cannot leak through.
 */
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
  const bleedBand = metrics.bleedPx * px;
  const gap = w + 2 * gapBand;
  if (opts.filled) {
    return [
      { kind: "outline", width: gap + 2 * ringBand, clip: "outside" },
      { kind: "knockout", width: gap, clip: "outside" },
    ];
  }
  return [
    { kind: "outline", width: gap + 2 * ringBand, clip: "outside" },
    { kind: "knockout", width: gap, clip: "outside" },
    { kind: "knockout", width: w + 2 * bleedBand, clip: "inside" },
    { kind: "paint", width: w },
  ];
}

/** Scale CSS px to device px for world-space non-scaling strokes. */
export function chromeDprScale(): number {
  if (typeof window === "undefined") return 1;
  return window.devicePixelRatio || 1;
}

const CLIP_EXTENT = 1e6;

/** Closed circle as a path, for even-odd outside clips. */
export function circleClipD(cx: number, cy: number, r: number): string {
  const rr = Math.abs(r);
  if (!(rr > 0) || !Number.isFinite(cx) || !Number.isFinite(cy)) return "";
  return `M${cx - rr},${cy}a${rr},${rr} 0 1,0 ${2 * rr},0a${rr},${rr} 0 1,0 ${-2 * rr},0z`;
}

/** Universe minus `inner` (closed path). Pair with `clip-rule="evenodd"`. */
export function outsideClipD(inner: string, extent = CLIP_EXTENT): string {
  if (!inner) return "";
  return `M${-extent},${-extent}H${extent}V${extent}H${-extent}Z${inner}`;
}

export function chromeOutsideClipId(key: string): string {
  return `chrome-out-${key.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

export function chromeInsideClipId(key: string): string {
  return `chrome-in-${key.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

export function chromeClipUrl(outsideId: string, insideId: string, layer: ChromeLayer): string | undefined {
  if (!layer.clip) return undefined;
  return `url(#${layer.clip === "inside" ? insideId : outsideId})`;
}
