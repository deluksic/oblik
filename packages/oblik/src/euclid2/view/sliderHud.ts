import type { TraceNode } from "@/eval/context";

const MARGIN = 12;
const PANEL_W = 200;
const PANEL_H = 56;
const STACK_GAP = 8;
const TRACK_H = 6;

export type SliderLayout = {
  node: TraceNode;
  panel: { x: number; y: number; w: number; h: number };
  track: { x: number; y: number; w: number; h: number };
  knobX: number;
  knobY: number;
};

export function snapEditNumber(raw: number, min: number, max: number, step: number): number {
  const clamped = Math.min(max, Math.max(min, raw));
  if (!(step > 0)) return clamped;
  return Math.round((clamped - min) / step) * step + min;
}

export function sliderNodes(trace: readonly TraceNode[]): TraceNode[] {
  return trace.filter((n) => n.occ === 0 && n.kind === "slider" && n.value.kind === "slider" && n.editable);
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
    const span = Math.max(1e-9, g.max - g.min);
    const t = Math.min(1, Math.max(0, (g.n - g.min) / span));
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
): TraceNode | null {
  const layouts = layoutSliders(nodes);
  for (let i = layouts.length - 1; i >= 0; i--) {
    const L = layouts[i];
    if (!L) continue;
    const { x, y, w, h } = L.panel;
    if (screen.x >= x && screen.x <= x + w && screen.y >= y && screen.y <= y + h) {
      return L.node;
    }
  }
  return null;
}

export function sliderValueFromPointer(node: TraceNode, screenX: number, nodes: readonly TraceNode[]): number {
  const g = node.value;
  if (g.kind !== "slider") return 0;
  const L = layoutSliders(nodes).find((s) => s.node.id === node.id);
  if (!L) return g.n;
  const t = (screenX - L.track.x) / L.track.w;
  const raw = g.min + t * (g.max - g.min);
  return snapEditNumber(raw, g.min, g.max, g.step);
}
