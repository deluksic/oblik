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
};

export type ChromeMetrics = {
  knockoutPx: number;
  hoverOutlineOpacity: number;
  selectOutlineOpacity: number;
};

export const DEFAULT_CHROME_METRICS: ChromeMetrics = {
  knockoutPx: 7,
  hoverOutlineOpacity: 0.25,
  selectOutlineOpacity: 0.5,
};

/** CSS `stroke-width` for a chrome layer (logical px). */
export function layerStrokeWidth(layer: ChromeLayer): string {
  return `${layer.width}px`;
}

/**
 * Base pass keeps paint order: knockout (if any) immediately before paint.
 * Overlay pass is outline only, drawn after the whole scene.
 */
export function chromeLayers(
  paintWidth: number,
  opts: ChromeOpts,
  metrics: ChromeMetrics = DEFAULT_CHROME_METRICS,
): ChromeLayer[] {
  const w = paintWidth > 0 ? paintWidth : 1;
  const hot = opts.selected || opts.hover;
  const px = opts.screenSpace ? 1 : chromeDprScale();
  const band = metrics.knockoutPx * px;
  if (opts.overlay) {
    if (!hot || !opts.knockout) return [];
    const outlineOpacity = opts.selected ? metrics.selectOutlineOpacity : metrics.hoverOutlineOpacity;
    return [{ kind: "outline", width: band, opacity: outlineOpacity }];
  }
  if (hot && opts.knockout) {
    return [
      { kind: "knockout", width: band },
      { kind: "paint", width: w },
    ];
  }
  return [{ kind: "paint", width: w }];
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
