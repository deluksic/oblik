import { type ChromeMetrics, DEFAULT_CHROME_METRICS } from "./chrome";

function cssLengthPx(style: CSSStyleDeclaration, prop: string): number | null {
  const raw = style.getPropertyValue(prop).trim();
  if (!raw) return null;
  const px = Number.parseFloat(raw);
  return Number.isFinite(px) ? px : null;
}

/** Device pixel ratio for mapping CSS px to non-scaling SVG strokes in world space. */
export function screenDpr(): number {
  if (typeof window === "undefined") return 1;
  return window.devicePixelRatio || 1;
}

/** Theme tokens for hover/select chrome, in CSS logical pixels. */
export function readChromeMetrics(): ChromeMetrics {
  if (typeof document === "undefined") return DEFAULT_CHROME_METRICS;
  const style = getComputedStyle(document.documentElement);
  return {
    gapPx: cssLengthPx(style, "--oblik-chrome-gap") ?? DEFAULT_CHROME_METRICS.gapPx,
    selectRingPx: cssLengthPx(style, "--oblik-chrome-ring") ?? DEFAULT_CHROME_METRICS.selectRingPx,
    hoverRingPx: cssLengthPx(style, "--oblik-chrome-ring-hover") ?? DEFAULT_CHROME_METRICS.hoverRingPx,
    bleedPx: cssLengthPx(style, "--oblik-chrome-bleed") ?? DEFAULT_CHROME_METRICS.bleedPx,
  };
}
