import { createGlobalTheme, createThemeContract, globalStyle } from "@vanilla-extract/css";

/**
 * Two-tier tokens. Tier 1 is the hue anchors below: every oklch() color picks
 * its hue from one of them, so re-tinting the theme is a few-number edit.
 * Tier 2 is the contract — light and dark declare the same token shape, so
 * they can't drift. Ink grays are warm (hue 85, opposite the blue backdrop);
 * text sitting on accent-tinted surfaces switches to the cool pair (hue 250)
 * so the warm/cool clash doesn't get extreme.
 */
const hueAnchors = createThemeContract({
  hueBackdrop: null,
  hueInk: null,
  hueInkCool: null,
  hueAccent: null,
  hueError: null,
  hueCream: null,
});

createGlobalTheme(":root", hueAnchors, {
  hueBackdrop: "270",
  hueInk: "85",
  hueInkCool: "250",
  hueAccent: "250",
  hueError: "35",
  hueCream: "70",
});

export const vars = createThemeContract({
  paper: null,
  raised: null,
  well: null,
  panel: null,
  ink: null,
  text: null,
  muted: null,
  dim: null,
  mutedCool: null,
  dimCool: null,
  accent: null,
  hover: null,
  error: null,
  ghost: null,
  knockout: null,
  cream: null,
  selectedPaint: null,
  line: null,
  grid: null,
  axis: null,
  ln: null,
  code: null,
  backdrop: null,
  panelShadow: null,
  stroke: null,
  strokeSelected: null,
  chromeOutline: null,
  chromeKnockout: null,
  chromePointOutline: null,
  chromePointKnockout: null,
  chromeOutlineHover: null,
  chromeOutlineSelected: null,
  hit: null,
});

const dark = {
  paper: `oklch(0.17 0.013 ${hueAnchors.hueBackdrop})`,
  raised: `oklch(0.2 0.017 ${hueAnchors.hueBackdrop})`,
  well: `oklch(0.21 0.017 ${hueAnchors.hueBackdrop})`,
  panel: `oklch(0.22 0.016 ${hueAnchors.hueBackdrop})`,
  ink: `oklch(0.86 0.02 ${hueAnchors.hueInk})`,
  text: `oklch(0.93 0.014 ${hueAnchors.hueInk})`,
  muted: `oklch(0.67 0.019 ${hueAnchors.hueInk})`,
  dim: `oklch(0.53 0.017 ${hueAnchors.hueInk})`,
  mutedCool: `oklch(0.67 0.019 ${hueAnchors.hueInkCool})`,
  dimCool: `oklch(0.53 0.017 ${hueAnchors.hueInkCool})`,
  accent: `oklch(0.59 0.125 ${hueAnchors.hueAccent})`,
  hover: `oklch(0.59 0.125 ${hueAnchors.hueAccent})`,
  error: `oklch(0.6 0.14 ${hueAnchors.hueError})`,
  ghost: `oklch(0.67 0.019 ${hueAnchors.hueInk})`,
  knockout: `${vars.paper}`,
  cream: `oklch(0.97 0.02 ${hueAnchors.hueCream})`,
  selectedPaint: `${vars.cream}`,
  line: `oklch(0.31 0.03 ${hueAnchors.hueBackdrop})`,
  grid: `oklch(0.25 0.028 ${hueAnchors.hueBackdrop})`,
  axis: `oklch(0.38 0.037 ${hueAnchors.hueBackdrop})`,
  ln: `oklch(0.47 0.014 ${hueAnchors.hueInk})`,
  code: `oklch(0.82 0.019 ${hueAnchors.hueInk})`,
  backdrop: `oklch(0.17 0.013 ${hueAnchors.hueBackdrop} / 0.62)`,
  panelShadow: "0 18px 40px #0008",
  stroke: "1.5px",
  strokeSelected: "2.25px",
  chromeOutline: "7px",
  chromeKnockout: "4px",
  chromePointOutline: "14px",
  chromePointKnockout: "9px",
  chromeOutlineHover: "0.5",
  chromeOutlineSelected: "1",
  hit: "14px",
};

const light = {
  paper: `oklch(0.965 0.007 ${hueAnchors.hueBackdrop})`,
  raised: `oklch(0.94 0.009 ${hueAnchors.hueBackdrop})`,
  well: `oklch(0.925 0.009 ${hueAnchors.hueBackdrop})`,
  panel: `oklch(0.91 0.01 ${hueAnchors.hueBackdrop})`,
  ink: `oklch(0.32 0.02 ${hueAnchors.hueInk})`,
  text: `oklch(0.24 0.02 ${hueAnchors.hueInk})`,
  muted: `oklch(0.5 0.019 ${hueAnchors.hueInk})`,
  dim: `oklch(0.62 0.016 ${hueAnchors.hueInk})`,
  mutedCool: `oklch(0.5 0.019 ${hueAnchors.hueInkCool})`,
  dimCool: `oklch(0.62 0.016 ${hueAnchors.hueInkCool})`,
  accent: `oklch(0.5 0.14 ${hueAnchors.hueAccent})`,
  hover: `oklch(0.5 0.14 ${hueAnchors.hueAccent})`,
  error: `oklch(0.55 0.16 ${hueAnchors.hueError})`,
  ghost: `oklch(0.5 0.019 ${hueAnchors.hueInk})`,
  knockout: `${vars.paper}`,
  cream: `oklch(0.45 0.06 ${hueAnchors.hueCream})`,
  selectedPaint: `oklch(0.55 0.12 ${hueAnchors.hueCream})`,
  line: `oklch(0.86 0.012 ${hueAnchors.hueBackdrop})`,
  grid: `oklch(0.9 0.012 ${hueAnchors.hueBackdrop})`,
  axis: `oklch(0.8 0.014 ${hueAnchors.hueBackdrop})`,
  ln: `oklch(0.72 0.012 ${hueAnchors.hueInk})`,
  code: `oklch(0.38 0.019 ${hueAnchors.hueInk})`,
  backdrop: `oklch(0.3 0.02 ${hueAnchors.hueBackdrop} / 0.4)`,
  panelShadow: `0 18px 40px oklch(0.3 0.02 ${hueAnchors.hueBackdrop} / 0.14)`,
  stroke: "1.5px",
  strokeSelected: "2.25px",
  chromeOutline: "7px",
  chromeKnockout: "4px",
  chromePointOutline: "14px",
  chromePointKnockout: "9px",
  chromeOutlineHover: "0.5",
  chromeOutlineSelected: "1",
  hit: "14px",
};

createGlobalTheme(":root", vars, dark);
createGlobalTheme(':root[data-theme="light"]', vars, light);

const scrollbarVars = createThemeContract({
  "scrollbar-thumb": null,
  "scrollbar-thumb-hover": null,
  "scrollbar-track": null,
});

createGlobalTheme(":root", scrollbarVars, {
  "scrollbar-thumb": `color-mix(in srgb, ${vars.muted} 42%, transparent)`,
  "scrollbar-thumb-hover": `color-mix(in srgb, ${vars.text} 28%, transparent)`,
  "scrollbar-track": "transparent",
});

// Bridge for unmigrated .module.css files, which reference the old literal
// token names. They alias the contract vars, so they re-resolve per theme.
// Remove once the last module migrates.
const legacyAliases = {
  "--oblik-paper": vars.paper,
  "--oblik-raised": vars.raised,
  "--oblik-well": vars.well,
  "--oblik-panel": vars.panel,
  "--oblik-ink": vars.ink,
  "--oblik-text": vars.text,
  "--oblik-muted": vars.muted,
  "--oblik-dim": vars.dim,
  "--oblik-muted-cool": vars.mutedCool,
  "--oblik-dim-cool": vars.dimCool,
  "--oblik-accent": vars.accent,
  "--oblik-hover": vars.hover,
  "--oblik-error": vars.error,
  "--oblik-ghost": vars.ghost,
  "--oblik-knockout": vars.knockout,
  "--oblik-cream": vars.cream,
  "--oblik-selected-paint": vars.selectedPaint,
  "--oblik-line": vars.line,
  "--oblik-grid": vars.grid,
  "--oblik-axis": vars.axis,
  "--oblik-ln": vars.ln,
  "--oblik-code": vars.code,
  "--oblik-stroke": vars.stroke,
  "--oblik-stroke-selected": vars.strokeSelected,
  "--oblik-chrome-outline": vars.chromeOutline,
  "--oblik-chrome-knockout": vars.chromeKnockout,
  "--oblik-chrome-point-outline": vars.chromePointOutline,
  "--oblik-chrome-point-knockout": vars.chromePointKnockout,
  "--oblik-chrome-outline-hover": vars.chromeOutlineHover,
  "--oblik-chrome-outline-selected": vars.chromeOutlineSelected,
  "--oblik-hit": vars.hit,
  "--oblik-scrollbar-thumb": scrollbarVars["scrollbar-thumb"],
  "--oblik-scrollbar-thumb-hover": scrollbarVars["scrollbar-thumb-hover"],
  "--oblik-scrollbar-track": scrollbarVars["scrollbar-track"],
};
globalStyle(":root", legacyAliases as unknown as Parameters<typeof globalStyle>[1]);

globalStyle("html, body, #app", {
  height: "100%",
  overflow: "hidden",
  background: vars.paper,
  color: vars.text,
  fontFamily: "system-ui, sans-serif",
});

globalStyle("*, *::before, *::after", {
  scrollbarWidth: "thin",
  scrollbarColor: `${scrollbarVars["scrollbar-thumb"]} ${scrollbarVars["scrollbar-track"]}`,
});

globalStyle("*::-webkit-scrollbar", {
  width: "10px",
  height: "10px",
});

globalStyle("*::-webkit-scrollbar-track", {
  background: scrollbarVars["scrollbar-track"],
});

globalStyle("*::-webkit-scrollbar-thumb", {
  backgroundColor: scrollbarVars["scrollbar-thumb"],
  border: "3px solid transparent",
  borderRadius: "999px",
  backgroundClip: "padding-box",
});

globalStyle("*::-webkit-scrollbar-thumb:hover", {
  backgroundColor: scrollbarVars["scrollbar-thumb-hover"],
});

globalStyle("*::-webkit-scrollbar-corner", {
  background: "transparent",
});