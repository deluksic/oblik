import { vec2f, vec3f, vec4f } from "typegpu/data";

import type { TraceNode } from "#eval/context";
import type { Circle, LoopEdge, Vec2 } from "#geom";
import { isFillGeom } from "#geom/csg2";
import { isGlider } from "#geom/gliders";
import { infiniteLineAxis, parallelLineValue } from "#geom/ops";
import { circleDelta } from "#geom/region";

import { infiniteClip, type Camera2, type PaneSize } from "../../euclid2/camera";
import { isCrossing } from "../../euclid2/place";
import { SNAP_DIAMOND_R, SNAP_R } from "../../euclid2/view/pointMark";
import { emptySpans, growSpanBox, newBox, pushLoopSpan, type SpanSet } from "./fillSpans";
import {
  CircleInst,
  FillRegion,
  MarkerInst,
  PointInst,
  StrokeCtrl,
  StrokeDraw,
  StrokeRun,
  RUN_GEOM_TWO_POINT,
} from "./schemas";

const TAU = Math.PI * 2;
/** Trace ghost band opacity (SVG TraceGhost `.band`). */
const TRACE_BAND = 0.55;
/** Ghost translucent fill: `color-mix(--oblik-ghost 18%, transparent)`. */
const GHOST_FILL_ALPHA = 0.18;
/** Dashed ghost ink: `color-mix(in srgb, --oblik-ink 70%, transparent)` keeps
 * the ink rgb and carries alpha 0.7. Dash lengths are constant on screen
 * (`5 4` CSS px) — the SVG ghost marks live in the screen-space hud layer, so
 * the dasharray does not scale with the world transform. */
const GHOST_STROKE_ALPHA = 0.7;
const DASH_ON = 5;
const DASH_GAP = 4;
/** Muted ink opacity (trace ghosts use the `.muted` Stroke style). */
const MUTED_ALPHA = 0.32;

/** CSS px knob mirrors of View.module.css ghost/snap classes. */
const GHOST_POINT_R = 4;
const CORNER_R = 5;
const CORNER_RING_R = 11;
const SNAP_RING_R = SNAP_R - 2;
const SNAP_STROKE_PX = 2;
/** snapDiamond stroke; ghostCorner/snapPoint strokes are 2px. */
const DIAMOND_STROKE_PX = 1.5;
const ARROW_STROKE_PX = 2.25;
const PAPER_STROKE_PX = 2;

export type Rgb = readonly [number, number, number];

export type CircleInstValue = ReturnType<typeof CircleInst>;
export type FillRegionValue = ReturnType<typeof FillRegion>;
export type PointInstValue = ReturnType<typeof PointInst>;
export type StrokeDrawValue = ReturnType<typeof StrokeDraw>;
export type MarkerInstValue = ReturnType<typeof MarkerInst>;

/** Per-frame ghost/snap geometry. `under` sits between the grid and the world
 * (registered-tool trace previews); `over` renders above the world. Ghost fill
 * spans are plain records (`fillSpans.ts`); the painter maps them to the GPU
 * structs, the same way the adapter maps the world fills. */
export type OverlayPatch = {
  under: {
    fills: FillRegionValue[];
    spans: SpanSet;
    strokes: StrokeDrawValue[];
    circles: CircleInstValue[];
  };
  over: {
    fills: FillRegionValue[];
    spans: SpanSet;
    strokes: StrokeDrawValue[];
    circles: CircleInstValue[];
    disks: PointInstValue[];
    markers: MarkerInstValue[];
  };
};

export type OverlayArgs = {
  ghost: Ghost | undefined;
  /** Snap marker under the cursor (SVG PlaceSnap); ignored for free points. */
  snap: PlaceHit | undefined;
  cam: Camera2;
  size: PaneSize;
  scale: number;
  strokePx: number;
  colors: { ink: Rgb; ghost: Rgb; paper: Rgb; accent: Rgb };
};

import type { Ghost, PlaceHit } from "../../euclid2/tool";

const px = (cssPx: number, scale: number) => cssPx / scale;
const rgbv = (c: Rgb) => vec3f(c[0], c[1], c[2]);
const centerOf = (p: Vec2) => vec2f(p.x, p.y);

function twoPoint(a: Vec2, b: Vec2, color: Rgb, alpha: number, radius: number): StrokeDrawValue {
  const ctrl = (p: Vec2) => StrokeCtrl({ position: centerOf(p), radius });
  return StrokeDraw({
    a: ctrl(a),
    b: ctrl(a),
    c: ctrl(b),
    d: ctrl(b),
    run: StrokeRun({ color: rgbv(color), alpha, start: 0, count: 0, flags: RUN_GEOM_TWO_POINT }),
  });
}

/** Pane-clipped extent of the infinite line through `origin` along `dir`. */
function infiniteEnds(
  origin: Vec2,
  dir: Vec2,
  cam: Camera2,
  size: PaneSize,
): { a: Vec2; b: Vec2 } | undefined {
  const len = Math.hypot(dir.x, dir.y);
  if (!Number.isFinite(len) || len < 1e-9) return undefined;
  const u = { x: dir.x / len, y: dir.y / len };
  const ends = infiniteClip(origin, u, cam, size);
  return ends.a && ends.b ? { a: ends.a, b: ends.b } : undefined;
}

/** Iterate `on`-world-unit dashes every `on + gap` from 0 over `len`. */
function forEachDash(
  len: number,
  on: number,
  gap: number,
  emit: (s0: number, s1: number) => boolean,
): void {
  if (!(len > 0) || !(on > 0)) return;
  let s = 0;
  while (s < len) {
    if (!emit(s, Math.min(s + on, len))) return;
    s += on + gap;
  }
}

// -- dash emission --------------------------------------------------------------

/** Straight dashes between `a` and `b` (dash pattern starts at `a`). Dash
 * lengths are constant on screen: 5/4 CSS px → world 5/4 per `scale`. */
function dashSegment(
  out: StrokeDrawValue[],
  a: Vec2,
  b: Vec2,
  color: Rgb,
  alpha: number,
  halfWidth: number,
  scale: number,
): void {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < 1e-9) return;
  const ux = (b.x - a.x) / len;
  const uy = (b.y - a.y) / len;
  forEachDash(len, DASH_ON / scale, DASH_GAP / scale, (s0, s1) => {
    out.push(
      twoPoint(
        { x: a.x + ux * s0, y: a.y + uy * s0 },
        { x: a.x + ux * s1, y: a.y + uy * s1 },
        color,
        alpha,
        halfWidth,
      ),
    );
    return true;
  });
}

/** Dashes along a circle/arc edge (SVG dashes a stroked path by its arc
 * length). Each dash is a ring band; round caps come from cap discs at both
 * ends. */
function dashArc(
  circles: CircleInstValue[],
  disks: PointInstValue[],
  center: Vec2,
  radius: number,
  a0: number,
  sweep: number,
  color: Rgb,
  alpha: number,
  halfWidth: number,
  scale: number,
): void {
  if (radius <= 0 || Math.abs(sweep) < 1e-9) return;
  const dir = sweep > 0 ? 1 : -1;
  const arcLen = radius * Math.abs(sweep);
  const piecesOf = (span: number) =>
    Math.min(128, Math.max(4, Math.ceil(Math.max(1, Math.abs(span) * radius * scale) / 6)));
  const pointAt = (ang: number): Vec2 => ({
    x: center.x + Math.cos(ang) * radius,
    y: center.y + Math.sin(ang) * radius,
  });
  const cap = (p: Vec2) =>
    disks.push(PointInst({ center: centerOf(p), radius: halfWidth, color: rgbv(color), alpha }));
  forEachDash(arcLen, DASH_ON / scale, DASH_GAP / scale, (s0, s1) => {
    if (s1 - s0 < 1e-6) return true;
    const ang0 = a0 + dir * (s0 / radius);
    const ang1 = a0 + dir * (s1 / radius);
    circles.push(
      CircleInst({
        center: centerOf(center),
        r0: Math.max(0, radius - halfWidth),
        r1: radius + halfWidth,
        a0: ang0,
        a1: ang1,
        pieces: piecesOf(ang1 - ang0),
        color: rgbv(color),
        alpha,
        flags: 0,
      }),
    );
    cap(pointAt(ang0));
    cap(pointAt(ang1));
    return true;
  });
}

/** Solid stroked ring (`rCenter ± halfWidth`), screen-space px already in
 * world units. */
function ring(
  out: CircleInstValue[],
  center: Vec2,
  rCenter: number,
  halfWidth: number,
  color: Rgb,
  alpha: number,
  scale: number,
): void {
  if (halfWidth <= 0 || rCenter < 0) return;
  out.push(
    CircleInst({
      center: centerOf(center),
      r0: Math.max(0, rCenter - halfWidth),
      r1: rCenter + halfWidth,
      a0: 0,
      a1: TAU,
      pieces: Math.min(128, Math.max(8, Math.ceil((TAU * Math.max(1, rCenter) * scale) / 6))),
      color: rgbv(color),
      alpha,
      flags: 0,
    }),
  );
}

function disc(
  out: PointInstValue[],
  center: Vec2,
  radius: number,
  color: Rgb,
  alpha: number,
): void {
  if (radius <= 0) return;
  out.push(PointInst({ center: centerOf(center), radius, color: rgbv(color), alpha }));
}

// -- fill islands ---------------------------------------------------------------

/** Convert a closed world chain into one normalized (CCW) fill island. */
function pushFillIsland(
  fills: FillRegionValue[],
  spans: SpanSet,
  chain: readonly LoopEdge[],
  color: Rgb,
  alpha: number,
  scale: number,
): void {
  if (chain.length < 3) return;
  const reversed = chainArea(chain) < 0;
  const segOffset = spans.segs.length;
  const arcOffset = spans.arcs.length;
  for (const e of chain) pushLoopSpan(spans, e, reversed);
  const segCount = spans.segs.length - segOffset;
  const arcCount = spans.arcs.length - arcOffset;
  const box = newBox();
  growSpanBox(box, spans, { segOffset, segCount, arcOffset, arcCount });
  if (!Number.isFinite(box.min.x)) {
    // A non-finite chain contributes no island quad, so it must not leave its
    // spans behind for the next island's window to swallow.
    spans.segs.length = segOffset;
    spans.arcs.length = arcOffset;
    return;
  }
  const pad = 2 / scale;
  fills.push(
    FillRegion({
      aabbMin: vec2f(box.min.x - pad, box.min.y - pad),
      aabbMax: vec2f(box.max.x + pad, box.max.y + pad),
      segOffset,
      segCount,
      arcOffset,
      arcCount,
      color: rgbv(color),
      alpha,
      flags: 0,
      // Ghost previews are never hot and carry no state colors.
      edge: vec4f(0, 0, 0, 0),
      edgeWidth: 0,
      haloRing: vec4f(0, 0, 0, 0),
      haloKnock: vec4f(0, 0, 0, 0),
      haloHalf: vec2f(0, 0),
    }),
  );
}

/** Shoelace over the chain's endpoint polygon (arcs approximated). */
function chainArea(edges: readonly LoopEdge[]): number {
  let sum = 0;
  for (const e of edges) {
    sum += e.a.x * e.b.y - e.b.x * e.a.y;
  }
  return sum / 2;
}

// -- region ghost ----------------------------------------------------------------

/** Dashed outline over a chain of world edges (arcs along their carriers). */
function dashChain(
  strokes: StrokeDrawValue[],
  circles: CircleInstValue[],
  disks: PointInstValue[],
  edges: readonly LoopEdge[],
  color: Rgb,
  alpha: number,
  halfWidth: number,
  scale: number,
): void {
  for (const e of edges) {
    if (e.carrier.kind === "circle") {
      const carrier = e.carrier as Circle;
      dashArc(
        circles,
        disks,
        { x: carrier.center.x, y: carrier.center.y },
        Math.abs(carrier.radius),
        Math.atan2(e.a.y - carrier.center.y, e.a.x - carrier.center.x),
        circleDelta(carrier, e.a, e.b, e.k ?? 1),
        color,
        alpha,
        halfWidth,
        scale,
      );
    } else {
      dashSegment(strokes, e.a, e.b, color, alpha, halfWidth, scale);
    }
  }
}

/** Solid shaft + filled arrowhead (SVG ghostArrow + ghostArrowHead). */
function pushArrow(
  strokes: StrokeDrawValue[],
  fills: FillRegionValue[],
  spans: SpanSet,
  arrow: { at: Vec2; tx: number; ty: number },
  ghost: Rgb,
  halfArrowWidth: number,
  scale: number,
): void {
  const n = Math.hypot(arrow.tx, arrow.ty) || 1;
  const ux = arrow.tx / n;
  const uy = arrow.ty / n;
  const pad = 10 / scale;
  const shaft = 20 / scale;
  const head = 7 / scale;
  const tail = { x: arrow.at.x + ux * pad, y: arrow.at.y + uy * pad };
  const tip = { x: tail.x + ux * shaft, y: tail.y + uy * shaft };
  const left = {
    x: tip.x - ux * head - uy * head * 0.62,
    y: tip.y - uy * head + ux * head * 0.62,
  };
  const right = {
    x: tip.x - ux * head + uy * head * 0.62,
    y: tip.y - uy * head - ux * head * 0.62,
  };
  pushFillIsland(
    fills,
    spans,
    [
      { a: tip, b: left, carrier: { kind: "segment", a: tip, b: left } },
      { a: left, b: right, carrier: { kind: "segment", a: left, b: right } },
      { a: right, b: tip, carrier: { kind: "segment", a: right, b: tip } },
    ],
    ghost,
    1,
    scale,
  );
  strokes.push(twoPoint(tail, tip, ghost, 1, halfArrowWidth));
}

// -- trace ghost -------------------------------------------------------------------

/** Straight/arcless paint for one ghost trace node (mirrors SVG TraceGhost:
 * fills + muted ink, whole band at 0.55). */
function pushTraceNode(
  strokes: StrokeDrawValue[],
  circles: CircleInstValue[],
  node: TraceNode,
  cam: Camera2,
  size: PaneSize,
  colors: { ink: Rgb; accent: Rgb },
  halfStroke: number,
  scale: number,
): void {
  const color = node.editable ? colors.accent : colors.ink;
  const alpha = MUTED_ALPHA * TRACE_BAND;
  const v = node.value;
  if (v.kind === "circle") {
    const r = Math.abs((v as Circle).radius);
    circles.push(
      CircleInst({
        center: vec2f((v as Circle).center.x, (v as Circle).center.y),
        r0: Math.max(0, r - halfStroke),
        r1: r + halfStroke,
        a0: 0,
        a1: TAU,
        pieces: Math.min(128, Math.max(8, Math.ceil((TAU * Math.max(1, r) * scale) / 6))),
        color: rgbv(color),
        alpha,
        flags: 0,
      }),
    );
    return;
  }
  const ends = nodeEnds(node, cam, size);
  if (!ends) return;
  const a = ends.a;
  const b = ends.b;
  strokes.push(
    StrokeDraw({
      a: StrokeCtrl({ position: vec2f(2 * a.x - b.x, 2 * a.y - b.y), radius: halfStroke }),
      b: StrokeCtrl({ position: vec2f(a.x, a.y), radius: halfStroke }),
      c: StrokeCtrl({ position: vec2f(b.x, b.y), radius: halfStroke }),
      d: StrokeCtrl({ position: vec2f(2 * b.x - a.x, 2 * b.y - a.y), radius: halfStroke }),
      run: StrokeRun({ color: rgbv(color), alpha, start: 0, count: 0, flags: 0 }),
    }),
  );
}

function nodeEnds(node: TraceNode, cam: Camera2, size: PaneSize): { a: Vec2; b: Vec2 } | undefined {
  const v = node.value;
  if (v.kind === "segment") return { a: v.a, b: v.b };
  if (v.kind === "line" || v.kind === "parallelLine") {
    const axis = infiniteLineAxis(v);
    if (!axis) return undefined;
    return infiniteEnds(axis.origin, axis.dir, cam, size);
  }
  return undefined;
}

// -- builder ------------------------------------------------------------------------

export function buildOverlay(args: OverlayArgs): OverlayPatch {
  const { cam, size, scale, strokePx, colors, ghost, snap } = args;
  const patch: OverlayPatch = {
    under: { fills: [], spans: emptySpans(), strokes: [], circles: [] },
    over: { fills: [], spans: emptySpans(), strokes: [], circles: [], disks: [], markers: [] },
  };
  const halfStroke = px(strokePx / 2, scale);

  // Trace ghosts (registered-tool drafts) render under the world, above the grid.
  if (ghost?.kind === "trace") {
    for (const n of ghost.nodes) {
      if (n.kind === "point" || n.kind === "slider" || isGlider(n.value) || isFillGeom(n.value)) {
        // Ghost fills are deferred until the region tool lands; mirrors the SVG
        // TraceGhost draw set for ink (segments/lines/parallels/circles).
        continue;
      }
      pushTraceNode(
        patch.under.strokes,
        patch.under.circles,
        n,
        cam,
        size,
        colors,
        halfStroke,
        scale,
      );
    }
  }

  // Region ghost: translucent fill of the partial chain (closed back to its
  // start), dashed chain including the hover edge, optional offset arrow.
  if (ghost?.kind === "region") {
    const chain = ghost.hover ? [...ghost.edges, ghost.hover] : ghost.edges;
    if (ghost.edges.length >= 2 && !ghost.loops) {
      const closeTo = chain.length > 0 ? chain[0]!.a : undefined;
      const closed = closeTo
        ? [...ghost.edges, straightEdge(chain[chain.length - 1]!.b, closeTo)]
        : ghost.edges;
      pushFillIsland(
        patch.over.fills,
        patch.over.spans,
        closed,
        colors.ghost,
        GHOST_FILL_ALPHA,
        scale,
      );
    }
    dashChain(
      patch.over.strokes,
      patch.over.circles,
      patch.over.disks,
      chain,
      colors.ink,
      GHOST_STROKE_ALPHA,
      halfStroke,
      scale,
    );
    if (ghost.arrow) {
      pushArrow(
        patch.over.strokes,
        patch.over.fills,
        patch.over.spans,
        ghost.arrow,
        colors.ghost,
        px(ARROW_STROKE_PX / 2, scale),
        scale,
      );
    }
  }

  // Snap marker under the cursor: diamond on crossings, stroked ring otherwise.
  // `diamondAt` also suppresses the coincident round ghost dot below: a point
  // ghost (point/circle/region tools snap their ghost to `point.at`) draws a
  // 4px-radius disc at this exact spot, and the diamond's inradius is only
  // `SNAP_DIAMOND_R/√2` ≈ 3.5px — so the disc would poke past every edge and
  // the pair would read as a circle.
  let diamondAt: Vec2 | undefined;
  if (snap && snap.point.kind !== "free") {
    const at = snap.point.at;
    if (isCrossing(snap.point)) {
      diamondAt = at;
      // One rotated-square instance (45° = diamond): the shader colors the
      // band between halfInner/halfOuter as the 1.5px outline.
      const halfSide = SNAP_DIAMOND_R / Math.SQRT2;
      const half = DIAMOND_STROKE_PX / 2;
      patch.over.markers.push(
        MarkerInst({
          center: centerOf(at),
          halfInner: Math.max(0, halfSide - half),
          halfOuter: halfSide + half,
          angle: Math.PI / 4,
          fill: rgbv(colors.ghost),
          stroke: rgbv(colors.paper),
          alpha: 1,
        }),
      );
    } else {
      ring(
        patch.over.circles,
        at,
        px(SNAP_RING_R, scale),
        px(SNAP_STROKE_PX / 2, scale),
        colors.ghost,
        1,
        scale,
      );
    }
  }

  /** True when a ghost point sits on the crossing diamond (within ~1 CSS px). */
  const hiddenByDiamond = (at: Vec2): boolean =>
    diamondAt !== undefined && Math.hypot(at.x - diamondAt.x, at.y - diamondAt.y) * scale <= 1;

  // Remaining ghost marks (SVG GhostMark), on top.
  if (ghost && ghost.kind !== "trace" && ghost.kind !== "region") {
    switch (ghost.kind) {
      case "point":
        if (!hiddenByDiamond(ghost.at)) {
          disc(patch.over.disks, ghost.at, px(GHOST_POINT_R, scale), colors.ghost, 1);
        }
        break;
      case "corner":
        ring(
          patch.over.circles,
          ghost.at,
          px(CORNER_RING_R, scale),
          px(PAPER_STROKE_PX / 2, scale),
          colors.ghost,
          1,
          scale,
        );
        disc(patch.over.disks, ghost.at, px(CORNER_R, scale), colors.ghost, 1);
        ring(
          patch.over.circles,
          ghost.at,
          px(CORNER_R, scale),
          px(PAPER_STROKE_PX / 2, scale),
          colors.paper,
          1,
          scale,
        );
        break;
      case "circle": {
        if (!hiddenByDiamond(ghost.center)) {
          disc(patch.over.disks, ghost.center, px(GHOST_POINT_R, scale), colors.ghost, 1);
        }
        dashArc(
          patch.over.circles,
          patch.over.disks,
          ghost.center,
          Math.abs(ghost.radius),
          0,
          TAU,
          colors.ink,
          GHOST_STROKE_ALPHA,
          halfStroke,
          scale,
        );
        break;
      }
      case "segment":
        dashSegment(
          patch.over.strokes,
          ghost.a,
          ghost.b,
          colors.ink,
          GHOST_STROKE_ALPHA,
          halfStroke,
          scale,
        );
        break;
      case "line": {
        const ends = infiniteEnds(
          ghost.a,
          { x: ghost.b.x - ghost.a.x, y: ghost.b.y - ghost.a.y },
          cam,
          size,
        );
        if (ends)
          dashSegment(
            patch.over.strokes,
            ends.a,
            ends.b,
            colors.ink,
            GHOST_STROKE_ALPHA,
            halfStroke,
            scale,
          );
        break;
      }
      case "parallelLine": {
        const pl = parallelLineValue(ghost.geom, ghost.distance);
        const line = pl.line;
        const ends = infiniteEnds(
          { x: line.origin.x, y: line.origin.y },
          { x: line.direction.x, y: line.direction.y },
          cam,
          size,
        );
        if (ends)
          dashSegment(
            patch.over.strokes,
            ends.a,
            ends.b,
            colors.ink,
            GHOST_STROKE_ALPHA,
            halfStroke,
            scale,
          );
        break;
      }
      case "tangent":
        ghost.strokes.forEach((s, i) => {
          const ends = infiniteEnds(s.a, { x: s.b.x - s.a.x, y: s.b.y - s.a.y }, cam, size);
          if (!ends) return;
          dashSegment(
            patch.over.strokes,
            ends.a,
            ends.b,
            colors.ink,
            i === ghost.chosen ? GHOST_STROKE_ALPHA : GHOST_STROKE_ALPHA * 0.3,
            halfStroke,
            scale,
          );
        });
        break;
      default:
        break;
    }
  }

  return patch;
}

function straightEdge(a: Vec2, b: Vec2): LoopEdge {
  return { a, b, carrier: { kind: "segment", a, b } };
}
