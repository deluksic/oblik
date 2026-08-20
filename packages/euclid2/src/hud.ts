import type { Gizmo, NumberGizmo } from "./widgets.ts";
import { snapEditNumber } from "./widgets.ts";

const MARGIN = 12;
const PANEL_W = 200;
const PANEL_H = 56;
const STACK_GAP = 8;
const TRACK_H = 6;

export type SliderLayout = {
  gizmo: NumberGizmo;
  panel: { x: number; y: number; w: number; h: number };
  track: { x: number; y: number; w: number; h: number };
  knobX: number;
  knobY: number;
};

/** Screen-space slots for non-world sliders, stacked from the bottom-left. */
export function layoutNumberSliders(
  gizmos: readonly Gizmo[],
  _cssW: number,
  cssH: number,
): SliderLayout[] {
  const nums = gizmos.filter((g): g is NumberGizmo => g.kind === "number");
  return nums.map((g, i) => {
    const x = MARGIN;
    const y = cssH - MARGIN - (i + 1) * PANEL_H - i * STACK_GAP;
    const trackX = x + 14;
    const trackW = PANEL_W - 28;
    const trackY = y + 36;
    const span = Math.max(1e-9, g.max - g.min);
    const t = Math.min(1, Math.max(0, (g.n - g.min) / span));
    return {
      gizmo: g,
      panel: { x, y, w: PANEL_W, h: PANEL_H },
      track: { x: trackX, y: trackY, w: trackW, h: TRACK_H },
      knobX: trackX + t * trackW,
      knobY: trackY + TRACK_H / 2,
    };
  });
}

export function hitNumberSlider(
  screen: { x: number; y: number },
  cssW: number,
  cssH: number,
  gizmos: readonly Gizmo[],
): NumberGizmo | null {
  const layouts = layoutNumberSliders(gizmos, cssW, cssH);
  for (let i = layouts.length - 1; i >= 0; i--) {
    const L = layouts[i];
    if (!L) continue;
    const { x, y, w, h } = L.panel;
    if (screen.x >= x && screen.x <= x + w && screen.y >= y && screen.y <= y + h) {
      return L.gizmo;
    }
  }
  return null;
}

export function numberValueFromPointer(
  gizmo: NumberGizmo,
  screenX: number,
  cssW: number,
  cssH: number,
  gizmos: readonly Gizmo[],
): number {
  const L = layoutNumberSliders(gizmos, cssW, cssH).find(
    (s) => s.gizmo.site === gizmo.site,
  );
  if (!L) return gizmo.n;
  const t = (screenX - L.track.x) / L.track.w;
  const raw = gizmo.min + t * (gizmo.max - gizmo.min);
  return snapEditNumber(raw, gizmo.min, gizmo.max, gizmo.step);
}
