export const CONSTRUCTION_STROKE_PX = 1.5;
export const POINT_STROKE_PX = 2;

export type ChromeKind = "knockout" | "outline" | "paint";

export type ChromeLayer = {
  kind: ChromeKind;
  width: number;
  opacity?: number;
};

export type ChromeOpts = {
  selected: boolean;
  hover: boolean;
  overlay: boolean;
  knockout: boolean;
  /** HUD / screen-space SVG where viewBox units are already CSS px. */
  screenSpace?: boolean;
  /** Points use a wider halo; the disc is small compared to a stroke. */
  point?: boolean;
};

export type ChromeMetrics = {
  knockoutPx: number;
  selectKnockoutPx: number;
  pointKnockoutPx: number;
  pointSelectKnockoutPx: number;
  hoverOutlineOpacity: number;
  selectOutlineOpacity: number;
};

export const DEFAULT_CHROME_METRICS: ChromeMetrics = {
  knockoutPx: 7,
  selectKnockoutPx: 4,
  pointKnockoutPx: 14,
  pointSelectKnockoutPx: 9,
  hoverOutlineOpacity: 0.5,
  selectOutlineOpacity: 1,
};

/** CSS `stroke-width` for a chrome layer (logical px). */
export function layerStrokeWidth(layer: ChromeLayer): string {
  return `${layer.width}px`;
}

/**
 * Base pass is paint only. Overlay sits under that paint:
 * hover is a translucent outline (no gap); selection is an opaque outline
 * with a thinner knockout on top to cut a paper gap inside the ring.
 * Stroke knockout grows with paint width so thick figure ink still shows a gap.
 */
export function chromeLayers(
  paintWidth: number,
  opts: ChromeOpts,
  metrics: ChromeMetrics = DEFAULT_CHROME_METRICS,
): ChromeLayer[] {
  const w = paintWidth > 0 ? paintWidth : 1;
  const hot = opts.selected || opts.hover;
  const px = opts.screenSpace ? 1 : chromeDprScale();
  const bands = overlayBands(w, opts, metrics);
  if (opts.overlay) {
    if (!hot || !opts.knockout) return [];
    const outline: ChromeLayer = {
      kind: "outline",
      width: bands.outline * px,
      opacity: opts.selected ? metrics.selectOutlineOpacity : metrics.hoverOutlineOpacity,
    };
    if (!opts.selected) return [outline];
    return [outline, { kind: "knockout", width: bands.knockout * px }];
  }
  return [{ kind: "paint", width: w }];
}

/** Outline and gap widths in CSS px, before device-pixel scaling. */
export function overlayBands(
  paintWidth: number,
  opts: Pick<ChromeOpts, "selected" | "point">,
  metrics: ChromeMetrics = DEFAULT_CHROME_METRICS,
): { outline: number; knockout: number } {
  if (opts.point) {
    return { outline: metrics.pointKnockoutPx, knockout: metrics.pointSelectKnockoutPx };
  }
  const outline = metrics.knockoutPx;
  const knockout = metrics.selectKnockoutPx;
  if (!opts.selected) return { outline, knockout };
  const gapPad = metrics.selectKnockoutPx - CONSTRUCTION_STROKE_PX;
  const ringPad = metrics.knockoutPx - metrics.selectKnockoutPx;
  const nextKnockout = Math.max(knockout, paintWidth + gapPad);
  return { outline: Math.max(outline, nextKnockout + ringPad), knockout: nextKnockout };
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

export function chromeClipUrl(id: string): string {
  return `url(#${id})`;
}
