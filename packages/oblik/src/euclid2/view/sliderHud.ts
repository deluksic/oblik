import type { TraceNode } from "#eval/context";

import { isFiniteTrace, snapEligible, type SnapFilter } from "../pick";

const { max, min, round } = Math;
/** HTML slider dock geometry. Kept in sync with `layoutSliders` so the
 * pure-coordinate hit tests (length tool, drag math) keep matching the DOM. */
export const SLIDER_MARGIN = 12;
export const SLIDER_PANEL_W = 200;
export const SLIDER_PANEL_H = 56;
export const SLIDER_STACK_GAP = 8;
export const SLIDER_TRACK_H = 6;
const MARGIN = SLIDER_MARGIN;
const PANEL_W = SLIDER_PANEL_W;
const PANEL_H = SLIDER_PANEL_H;
const STACK_GAP = SLIDER_STACK_GAP;
const TRACK_H = SLIDER_TRACK_H;

/** Vertical scroll of the HTML slider dock (0 when unscrolled). The dock feeds
 * this so screen-space hit tests track panels after the list has scrolled. */
let dockScrollTop = 0;
export function setSliderDockScrollTop(y: number): void {
  dockScrollTop = y;
}
export function sliderDockScrollTop(): number {
  return dockScrollTop;
}

export type SliderLayout = {
  node: TraceNode;
  panel: { x: number; y: number; w: number; h: number };
  track: { x: number; y: number; w: number; h: number };
  knobX: number;
  knobY: number;
};

export function snapEditNumber(raw: number, minVal: number, maxVal: number, step: number): number {
  const clamped = min(maxVal, max(minVal, raw));
  if (!(step > 0)) return clamped;
  return round((clamped - minVal) / step) * step + minVal;
}

export function sliderNodes(trace: readonly TraceNode[], filter?: SnapFilter): TraceNode[] {
  return trace.filter(
    (n) =>
      n.kind === "slider" &&
      n.value.kind === "slider" &&
      n.editable &&
      isFiniteTrace(n) &&
      (!filter || snapEligible(n, filter)),
  );
}

/** Screen-space slots for number sliders, stacked from the top-left. */
export function layoutSliders(nodes: readonly TraceNode[]): SliderLayout[] {
  return nodes.map((node, i) => {
    const g = node.value;
    if (g.kind !== "slider") throw new Error("expected slider trace");
    const x = MARGIN;
    const y = MARGIN + i * (PANEL_H + STACK_GAP);
    const trackX = x + 14;
    const trackW = PANEL_W - 28;
    const trackY = y + 36;
    const span = max(1e-9, g.max - g.min);
    const t = min(1, max(0, (g.n - g.min) / span));
    return {
      node,
      panel: { x, y, w: PANEL_W, h: PANEL_H },
      track: { x: trackX, y: trackY, w: trackW, h: TRACK_H },
      knobX: trackX + t * trackW,
      knobY: trackY + TRACK_H / 2,
    };
  });
}

export function hitSlider(
  screen: { x: number; y: number },
  nodes: readonly TraceNode[],
): TraceNode | undefined {
  const y = screen.y + dockScrollTop;
  const layouts = layoutSliders(nodes);
  for (let i = layouts.length - 1; i >= 0; i--) {
    const L = layouts[i];
    if (!L) continue;
    const { x, w, h } = L.panel;
    if (screen.x >= x && screen.x <= x + w && y >= L.panel.y && y <= L.panel.y + h) {
      return L.node;
    }
  }
  return undefined;
}

export function sliderValueFromPointer(
  node: TraceNode,
  screenX: number,
  nodes: readonly TraceNode[],
): number {
  const g = node.value;
  if (g.kind !== "slider") return 0;
  const L = layoutSliders(nodes).find((s) => s.node.id === node.id);
  if (!L) return g.n;
  const t = (screenX - L.track.x) / L.track.w;
  const raw = g.min + t * (g.max - g.min);
  return snapEditNumber(raw, g.min, g.max, g.step);
}
