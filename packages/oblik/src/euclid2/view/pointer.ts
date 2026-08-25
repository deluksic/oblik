import type { TraceNode } from "../../eval/context";
import type { Circle, Line, ParallelLine, Point } from "../../geom";
import { lineBasis, signedDist } from "../../geom/ops";
import { mul, perp, sub } from "../../geom/vec";
import { clientToNdc, ndcToWorld, type Camera2, type PaneSize } from "../camera";
import { hitsNear, movedPastClick } from "../pick";
import { placeSnapWorld, resolvePlacePoint } from "../place";
import { enrichHit, type PlaceHit, type ToolSession } from "../tool";
import { sliderNodes, sliderValueFromPointer } from "./sliderHud";

export type Drag =
  | {
      kind: "pan";
      x: number;
      y: number;
      camX: number;
      camY: number;
      moved: boolean;
    }
  | {
      kind: "point";
      id: string;
      node: TraceNode;
      startX: number;
      startY: number;
      pointerX: number;
      pointerY: number;
      downX: number;
      downY: number;
      moved: boolean;
    }
  | {
      kind: "radius";
      id: string;
      node: TraceNode;
      startR: number;
      origin: { x: number; y: number };
      grabDist: number;
      downX: number;
      downY: number;
      moved: boolean;
    }
  | {
      kind: "parallel";
      id: string;
      node: TraceNode;
      startD: number;
      base: Line;
      grabSigned: number;
      downX: number;
      downY: number;
      moved: boolean;
    }
  | {
      kind: "slider";
      id: string;
      node: TraceNode;
      startN: number;
      downX: number;
      downY: number;
      moved: boolean;
    };

export function round(n: number): number {
  return Math.round(n * 100) / 100;
}

export function worldOf(
  e: PointerEvent,
  el: HTMLDivElement | null,
  camera: Camera2,
  size: PaneSize,
): { x: number; y: number } {
  if (!el) return { x: 0, y: 0 };
  const rect = el.getBoundingClientRect();
  const ndc = clientToNdc({ x: e.clientX, y: e.clientY }, rect, size);
  return ndcToWorld(ndc, camera, size);
}

export function pointDrag(node: TraceNode, w: { x: number; y: number }, e: PointerEvent): Drag {
  const p = node.value as Point;
  return {
    kind: "point",
    id: node.id,
    node,
    startX: p.x,
    startY: p.y,
    pointerX: w.x,
    pointerY: w.y,
    downX: e.clientX,
    downY: e.clientY,
    moved: false,
  };
}

export function radiusDrag(node: TraceNode, w: { x: number; y: number }, e: PointerEvent): Drag {
  const c = node.value as Circle;
  return {
    kind: "radius",
    id: node.id,
    node,
    startR: c.radius,
    origin: c.center,
    grabDist: Math.hypot(w.x - c.center.x, w.y - c.center.y),
    downX: e.clientX,
    downY: e.clientY,
    moved: false,
  };
}

function carrierLine(ol: ParallelLine): Line {
  const { origin, dir } = lineBasis(ol);
  return {
    kind: "line",
    origin: sub(origin, mul(perp(dir), ol.distance)),
    direction: dir,
  };
}

export function parallelDrag(node: TraceNode, w: { x: number; y: number }, e: PointerEvent): Drag {
  const ol = node.value as ParallelLine;
  const base = carrierLine(ol);
  return {
    kind: "parallel",
    id: node.id,
    node,
    startD: ol.distance,
    base,
    grabSigned: signedDist(w, base),
    downX: e.clientX,
    downY: e.clientY,
    moved: false,
  };
}

export function sliderDrag(node: TraceNode, e: PointerEvent): Drag {
  const g = node.value;
  const startN = g.kind === "slider" ? g.n : 0;
  return {
    kind: "slider",
    id: node.id,
    node,
    startN,
    downX: e.clientX,
    downY: e.clientY,
    moved: false,
  };
}

export function panDrag(e: PointerEvent, camera: Camera2): Drag {
  return {
    kind: "pan",
    x: e.clientX,
    y: e.clientY,
    camX: camera.x,
    camY: camera.y,
    moved: false,
  };
}

export function placeFromEvent(
  e: PointerEvent,
  el: HTMLDivElement | null,
  camera: Camera2,
  size: PaneSize,
  trace: TraceNode[],
  tool?: ToolSession | null,
): PlaceHit {
  const w = worldOf(e, el, camera, size);
  let point = resolvePlacePoint(trace, w, placeSnapWorld(camera.scale));
  const t = e.target;
  if (t instanceof Element && t.hasAttribute("data-handle")) {
    const id = t.getAttribute("data-handle")!;
    const found = trace.find((n) => n.id === id && n.occ === 0) ?? trace.find((n) => n.id === id);
    if (found?.bind && found.value.kind === "point") {
      point = {
        kind: "ref",
        bind: found.bind,
        id: found.id,
        at: { x: found.value.x, y: found.value.y },
      };
    }
  }
  const hit: PlaceHit = { world: w, point };
  return tool ? enrichHit(tool, hit, { trace, camera, size }) : hit;
}

export function applyDrag(
  drag: Drag,
  e: PointerEvent,
  el: HTMLDivElement | null,
  camera: Camera2,
  size: PaneSize,
  trace: readonly TraceNode[] = [],
): { camera?: Camera2; draft?: { id: string; values: number[] } } {
  if (drag.kind === "pan") {
    return {
      camera: {
        ...camera,
        x: drag.camX - (e.clientX - drag.x) / camera.scale,
        y: drag.camY + (e.clientY - drag.y) / camera.scale,
      },
    };
  }
  const w = worldOf(e, el, camera, size);
  if (drag.kind === "point") {
    return {
      draft: {
        id: drag.id,
        values: [round(drag.startX + (w.x - drag.pointerX)), round(drag.startY + (w.y - drag.pointerY))],
      },
    };
  }
  if (drag.kind === "parallel") {
    const signed = signedDist(w, drag.base);
    return { draft: { id: drag.id, values: [round(drag.startD + (signed - drag.grabSigned))] } };
  }
  if (drag.kind === "slider") {
    if (!el) return {};
    const rect = el.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const n = sliderValueFromPointer(drag.node, screenX, sliderNodes(trace));
    return { draft: { id: drag.id, values: [round(n)] } };
  }
  const now = Math.hypot(w.x - drag.origin.x, w.y - drag.origin.y);
  return { draft: { id: drag.id, values: [round(Math.max(0.05, drag.startR + (now - drag.grabDist)))] } };
}

export function dragMoved(drag: Drag, e: PointerEvent): boolean {
  const fromX = drag.kind === "pan" ? drag.x : drag.downX;
  const fromY = drag.kind === "pan" ? drag.y : drag.downY;
  return movedPastClick(fromX, fromY, e.clientX, e.clientY);
}

export function topHit(
  e: PointerEvent,
  el: HTMLDivElement | null,
  camera: Camera2,
  size: PaneSize,
  trace: TraceNode[],
): TraceNode[] {
  return hitsNear(trace, worldOf(e, el, camera, size), camera, size);
}
