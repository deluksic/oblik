import { type ChromeMetrics, DEFAULT_CHROME_METRICS } from "./chrome";

function cssLengthPx(style: CSSStyleDeclaration, prop: string): number | null {
  const raw = style.getPropertyValue(prop).trim();
  if (!raw) return null;
  const px = Number.parseFloat(raw);
  return Number.isFinite(px) ? px : null;
}

function cssNumber(style: CSSStyleDeclaration, prop: string): number | null {
  const raw = style.getPropertyValue(prop).trim();
  if (!raw) return null;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : null;
}

/** Device pixel ratio for mapping CSS px to non-scaling SVG strokes in world space. */
export function screenDpr(): number {
  if (typeof window === "undefined") return 1;
  return window.devicePixelRatio || 1;
}

/** Theme tokens for hover/select chrome. */
export function readChromeMetrics(): ChromeMetrics {
  if (typeof document === "undefined") return DEFAULT_CHROME_METRICS;
  const style = getComputedStyle(document.documentElement);
  return {
    knockoutPx: cssLengthPx(style, "--oblik-chrome-knockout") ?? DEFAULT_CHROME_METRICS.knockoutPx,
    selectKnockoutPx: cssLengthPx(style, "--oblik-chrome-knockout-selected") ?? DEFAULT_CHROME_METRICS.selectKnockoutPx,
    pointKnockoutPx: cssLengthPx(style, "--oblik-chrome-point") ?? DEFAULT_CHROME_METRICS.pointKnockoutPx,
    pointSelectKnockoutPx: cssLengthPx(style, "--oblik-chrome-point-selected") ?? DEFAULT_CHROME_METRICS.pointSelectKnockoutPx,
    hoverOutlineOpacity: cssNumber(style, "--oblik-chrome-outline-hover") ?? DEFAULT_CHROME_METRICS.hoverOutlineOpacity,
    selectOutlineOpacity: cssNumber(style, "--oblik-chrome-outline-selected") ?? DEFAULT_CHROME_METRICS.selectOutlineOpacity,
  };
}
