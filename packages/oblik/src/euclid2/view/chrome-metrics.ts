import { type ChromeMetrics, DEFAULT_CHROME_METRICS } from "./chrome";

function cssLengthPx(style: CSSStyleDeclaration, prop: string): number | undefined {
  const raw = style.getPropertyValue(prop).trim();
  if (!raw) return undefined;
  const px = Number.parseFloat(raw);
  return Number.isFinite(px) ? px : undefined;
}

function cssNumber(style: CSSStyleDeclaration, prop: string): number | undefined {
  const raw = style.getPropertyValue(prop).trim();
  if (!raw) return undefined;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : undefined;
}

/** Theme tokens for hover/select chrome. See docs/chrome.md. */
export function readChromeMetrics(): ChromeMetrics {
  if (typeof document === "undefined") return DEFAULT_CHROME_METRICS;
  const style = getComputedStyle(document.documentElement);
  return {
    outlinePx: cssLengthPx(style, "--oblik-chrome-outline") ?? DEFAULT_CHROME_METRICS.outlinePx,
    knockoutPx: cssLengthPx(style, "--oblik-chrome-knockout") ?? DEFAULT_CHROME_METRICS.knockoutPx,
    pointOutlinePx:
      cssLengthPx(style, "--oblik-chrome-point-outline") ?? DEFAULT_CHROME_METRICS.pointOutlinePx,
    pointKnockoutPx:
      cssLengthPx(style, "--oblik-chrome-point-knockout") ?? DEFAULT_CHROME_METRICS.pointKnockoutPx,
    hoverOutlineOpacity:
      cssNumber(style, "--oblik-chrome-outline-hover") ??
      DEFAULT_CHROME_METRICS.hoverOutlineOpacity,
    selectOutlineOpacity:
      cssNumber(style, "--oblik-chrome-outline-selected") ??
      DEFAULT_CHROME_METRICS.selectOutlineOpacity,
  };
}
