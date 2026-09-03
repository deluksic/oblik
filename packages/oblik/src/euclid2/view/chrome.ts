const { abs, max } = Math;
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
  /** HUD / screen-space SVG where viewBox units are already CSS px. */
  screenSpace?: boolean;
  /** Points use a wider halo; the disc is small compared to a stroke. */
  point?: boolean;
};

export type ChromeMetrics = {
  outlinePx: number;
  knockoutPx: number;
  pointOutlinePx: number;
  pointKnockoutPx: number;
  hoverOutlineOpacity: number;
  selectOutlineOpacity: number;
};

export const DEFAULT_CHROME_METRICS: ChromeMetrics = {
  outlinePx: 7,
  knockoutPx: 4,
  pointOutlinePx: 14,
  pointKnockoutPx: 9,
  hoverOutlineOpacity: 0.5,
  selectOutlineOpacity: 1,
};

/** CSS `stroke-width` for a chrome layer (logical px). */
export function layerStrokeWidth(layer: ChromeLayer): string {
  return `${layer.width}px`;
}

/**
 * Overlay under paint. Hover: translucent outline, no gap.
 * Selected: opaque outline, then thinner paper knockout on top.
 * See docs/chrome.md. Views skip overlay passes while dragging.
 */
export function chromeLayers(
  paintWidth: number,
  opts: ChromeOpts,
  metrics: ChromeMetrics = DEFAULT_CHROME_METRICS,
): ChromeLayer[] {
  const w = paintWidth > 0 ? paintWidth : 1;
  const hot = opts.selected || opts.hover;
  const px = opts.screenSpace ? 1 : chromeDprScale();
  if (opts.overlay) {
    if (!hot) return [];
    const { outline, knockout } = overlayBands(w, opts, metrics);
    const halo: ChromeLayer = {
      kind: "outline",
      width: outline * px,
      opacity: opts.selected ? metrics.selectOutlineOpacity : metrics.hoverOutlineOpacity,
    };
    if (!opts.selected) return [halo];
    return [halo, { kind: "knockout", width: knockout * px }];
  }
  return [{ kind: "paint", width: w }];
}

/** Outline / knockout widths in CSS px, before device-pixel scaling. See docs/chrome.md. */
export function overlayBands(
  paintWidth: number,
  opts: Pick<ChromeOpts, "selected" | "point">,
  metrics: ChromeMetrics = DEFAULT_CHROME_METRICS,
): { outline: number; knockout: number } {
  if (opts.point) {
    return { outline: metrics.pointOutlinePx, knockout: metrics.pointKnockoutPx };
  }
  if (!opts.selected) return { outline: metrics.outlinePx, knockout: metrics.knockoutPx };
  // 7/4 was designed around a 1.5px stroke: 2.5px paper extra, 3px ring extra.
  const paper = metrics.knockoutPx - CONSTRUCTION_STROKE_PX;
  const ring = metrics.outlinePx - metrics.knockoutPx;
  const knockout = max(metrics.knockoutPx, paintWidth + paper);
  return { outline: max(metrics.outlinePx, knockout + ring), knockout };
}

/** Scale CSS px to device px for world-space non-scaling strokes. */
export function chromeDprScale(): number {
  if (typeof window === "undefined") return 1;
  return window.devicePixelRatio || 1;
}

export function chromeLayersEqual(a: readonly ChromeLayer[], b: readonly ChromeLayer[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (x.kind !== y.kind || x.width !== y.width || x.opacity !== y.opacity) return false;
  }
  return true;
}

const CLIP_EXTENT = 1e6;

/** Closed circle as a path, for even-odd outside clips. */
export function circleClipD(cx: number, cy: number, r: number): string {
  const rr = abs(r);
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

export function chromeClipUrl(id: string): string {
  return `url(#${id})`;
}
