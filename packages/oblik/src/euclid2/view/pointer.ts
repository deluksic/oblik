import type { TraceNode } from "@/eval/context";
import type { Circle, Glider, LineLike, ParallelLine, Point, Segment } from "@/geom";
import { circleUnitAt, clamp01, gliderAt, isGlider, lineSAt, segmentTAt } from "@/geom/gliders";
import { lineBasis, signedDist } from "@/geom/ops";
import { mul, perp, sub } from "@/geom/vec";
import { clientToNdc, ndcToWorld, type Camera2, type PaneSize } from "../camera";
import { hitsNear, movedPastClick, nodeByTraceAttr, traceKey, type SnapFilter } from "../pick";
import { gliderOnTraceNode, gliderSnapWorld, isCrossing, placeAllowsGliders, placeSnapWorld, resolvePlacePoint } from "../place";
import { enrichHit, type PlaceHit, type Scope, type ToolSession } from "../tool";
import { hitSlider, sliderNodes, sliderValueFromPointer } from "./sliderHud";

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
    }
  | {
      kind: "gliderSegment";
      id: string;
      node: TraceNode;
      seg: Segment;
      startT: number;
      grabT: number;
      downX: number;
      downY: number;
      moved: boolean;
    }
  | {
      kind: "gliderLine";
      id: string;
      node: TraceNode;
      geom: LineLike;
      startS: number;
      grabS: number;
      downX: number;
      downY: number;
      moved: boolean;
    }
  | {
      kind: "gliderCircle";
      id: string;
      node: TraceNode;
      circle: Circle;
      startUx: number;
      startUy: number;
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

export function gliderDrag(node: TraceNode, w: { x: number; y: number }, e: PointerEvent): Drag | null {
  const g = node.value as Glider;
  if (g.kind === "gliderSegment") {
    return {
      kind: "gliderSegment",
      id: node.id,
      node,
      seg: { kind: "segment", a: g.a, b: g.b },
      startT: g.t,
      grabT: segmentTAt({ kind: "segment", a: g.a, b: g.b }, w),
      downX: e.clientX,
      downY: e.clientY,
      moved: false,
    };
  }
  if (g.kind === "gliderLine") {
    const geom: LineLike = { kind: "line", origin: g.origin, direction: g.direction };
    return {
      kind: "gliderLine",
      id: node.id,
      node,
      geom,
      startS: g.s,
      grabS: lineSAt(geom, w),
      downX: e.clientX,
      downY: e.clientY,
      moved: false,
    };
  }
  if (g.kind === "gliderCircle") {
    const circle: Circle = { kind: "circle", center: g.center, radius: g.radius };
    return {
      kind: "gliderCircle",
      id: node.id,
      node,
      circle,
      startUx: g.ux,
      startUy: g.uy,
      downX: e.clientX,
      downY: e.clientY,
      moved: false,
    };
  }
  return null;
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
  filter?: SnapFilter,
  scope?: Scope,
): PlaceHit {
  const w = worldOf(e, el, camera, size);
  const snap = placeSnapWorld(camera.scale);
  const allowGliders = placeAllowsGliders(tool);
  let point = resolvePlacePoint(trace, w, snap, gliderSnapWorld(camera.scale), {
    allowGliders,
    keys: filter?.keys,
    print: filter?.print,
  });
  const t = e.target;
  if (t instanceof Element && t.hasAttribute("data-handle")) {
    const id = t.getAttribute("data-handle")!;
    const found = nodeByTraceAttr(trace, id);
    if (found && (found.value.kind === "point" || isGlider(found.value))) {
      const allowed = !filter?.keys || filter.keys.has(traceKey(found));
      const bind = filter?.print?.(found) ?? found.bind;
      if (allowed && bind) {
        const at = found.value.kind === "point" ? found.value : gliderAt(found.value);
        point = {
          kind: "ref",
          bind,
          id: found.id,
          at: { x: at.x, y: at.y },
        };
      }
    }
  } else if (allowGliders && t instanceof Element && point.kind !== "ref" && !isCrossing(point)) {
    const ink = t.closest("[data-ink]");
    const id = ink?.getAttribute("data-ink");
    if (id) {
      const found = nodeByTraceAttr(trace, id);
      const allowed = found && (!filter?.keys || filter.keys.has(traceKey(found)));
      const g = found && allowed ? gliderOnTraceNode(found, w, filter?.print?.(found)) : null;
      if (g) point = g;
    }
  }
  let length: PlaceHit["length"];
  if (t instanceof Element) {
    const sliderEl = t.closest("[data-slider]");
    const sid = sliderEl?.getAttribute("data-slider");
    if (sid) {
      const found = nodeByTraceAttr(trace, sid);
      if (found?.value.kind === "slider") {
        const name = filter?.print?.(found) ?? found.bind;
        if (name && (!filter?.keys || filter.keys.has(traceKey(found)))) {
          length = { expr: { kind: "ref", name }, value: found.value.n };
        }
      }
    }
  }
  const screen = el
    ? { x: e.clientX - el.getBoundingClientRect().left, y: e.clientY - el.getBoundingClientRect().top }
    : undefined;
  if (!length && screen) {
    const slider = hitSlider(screen, sliderNodes(trace));
    if (slider?.value.kind === "slider") {
      const name = filter?.print?.(slider) ?? slider.bind;
      if (name && (!filter?.keys || filter.keys.has(traceKey(slider)))) {
        length = { expr: { kind: "ref", name }, value: slider.value.n };
      }
    }
  }
  const hit: PlaceHit = { world: w, point, ...(length ? { length } : {}) };
  const ctx = {
    trace,
    camera,
    size,
    screen,
    target: t,
    keys: filter?.keys,
    print: filter?.print,
    scope,
  };
  return tool ? enrichHit(tool, hit, ctx) : hit;
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
  if (drag.kind === "gliderSegment") {
    const t = segmentTAt(drag.seg, w);
    return { draft: { id: drag.id, values: [round(clamp01(drag.startT + (t - drag.grabT)))] } };
  }
  if (drag.kind === "gliderLine") {
    const s = lineSAt(drag.geom, w);
    return { draft: { id: drag.id, values: [round(drag.startS + (s - drag.grabS))] } };
  }
  if (drag.kind === "gliderCircle") {
    const { ux, uy } = circleUnitAt(drag.circle, w);
    return { draft: { id: drag.id, values: [round(ux), round(uy)] } };
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
