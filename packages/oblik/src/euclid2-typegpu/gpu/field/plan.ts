import type { Circle, Csg2, CsgOperand, HalfPlane, Offset, PolarRepeat, Region, Vec2 } from "#geom";
import { lineBasis } from "#geom/ops";
import { repeatStep } from "#geom/repeat";
import { mul, perp } from "#geom/vec";

import {
  emptySpans,
  grow,
  growSpanBox,
  islandSpans,
  newBox,
  type Box,
  type SpanSet,
  type SpanWindow,
} from "../fillSpans";

/**
 * A compiled CSG field: the tree *shape* is baked into the shader, every number
 * it reads is data. The shape string is the cache key — two nodes with the same
 * shape (the demo scenes have ~9 across 13 scenes) share one compiled pipeline
 * no matter where they sit, while a drag only rewrites leaf data.
 *
 * Mirrors `operandSdf`/`csgSdf` in `geom/csg2.ts` one-for-one: that is the
 * reference, and `eval.ts` is its TS twin for `field/plan.test.ts` parity runs.
 */

export type FieldLeafKind = "circle" | "halfPlane" | "spans" | "offset" | "repeat";

export type FieldLeafPlan =
  | { kind: "circle"; operand: Circle }
  | { kind: "halfPlane"; operand: HalfPlane }
  | { kind: "spans"; operand: Region }
  | { kind: "offset"; operand: Offset }
  | { kind: "repeat"; operand: PolarRepeat };

export type FieldNodePlan =
  | { kind: "leaf"; leaf: number }
  | { kind: "offset"; leaf: number; of: FieldNodePlan }
  /** Fold the point into the nearest copy, then evaluate the child there. */
  | { kind: "repeat"; leaf: number; of: FieldNodePlan }
  | { kind: "union" | "intersect" | "diff"; of: FieldNodePlan[] };

export type FieldPlan = {
  /** Structural signature — everything the emitted WGSL depends on, nothing else. */
  shape: string;
  /** Leaves in traversal order; the shader addresses them by this index. */
  leaves: FieldLeafPlan[];
  root: FieldNodePlan;
};

/** One leaf's parameters, exactly as the GPU stores them. */
export type FieldLeafData = SpanWindow & {
  /** Circle centre | half-plane origin | repeat axis. */
  a: Vec2;
  /** Half-plane inside normal (`perp(dir) · −side`); `(rotation, step)` for a
   * repeat; unused otherwise. */
  b: Vec2;
  /** Circle radius | offset distance | repeat copy count (the shader folds with
   * `b` alone; the count is what the CPU twin and the docs read). */
  r: number;
};

/** The data behind one compiled field: leaf records plus the split span arrays
 * `spans` leaves window into — the same buffers the adapter writes. */
export type FieldInstance = { leaves: FieldLeafData[]; spans: SpanSet };

const ORIGIN: Vec2 = { x: 0, y: 0 };
/** Scalar leaves (no `spans` window) read nothing from the span arrays. */
const NO_SPANS: SpanWindow = { segOffset: 0, segCount: 0, arcOffset: 0, arcCount: 0 };

/** Plan a fill tree for GPU evaluation. `undefined` when the tree holds
 * anything that is not a single scalar field — a `pick` (island-restricted), a
 * polygon, an empty boolean — which keeps that node on the span path. */
export function fieldPlan(op: CsgOperand): FieldPlan | undefined {
  const leaves: FieldLeafPlan[] = [];
  const planned = planOf(op, leaves);
  return planned ? { shape: planned.shape, leaves, root: planned.node } : undefined;
}

type Planned = { node: FieldNodePlan; shape: string };

function planOf(op: CsgOperand, leaves: FieldLeafPlan[]): Planned | undefined {
  if (op.kind === "region") {
    return { node: addLeaf(leaves, { kind: "spans", operand: op }), shape: "region" };
  }
  if (op.kind === "circle") {
    return { node: addLeaf(leaves, { kind: "circle", operand: op }), shape: "circle" };
  }
  if (op.kind === "halfPlane") {
    return { node: addLeaf(leaves, { kind: "halfPlane", operand: op }), shape: "halfPlane" };
  }
  if (op.kind === "offset") {
    const inner = planOf(op.of, leaves);
    if (!inner) return undefined;
    const leaf = leaves.length;
    leaves.push({ kind: "offset", operand: op });
    return {
      node: { kind: "offset", leaf, of: inner.node },
      shape: `offset(${inner.shape})`,
    };
  }
  if (op.kind === "polarRepeat") {
    // The copies stay implicit: one leaf of numbers, the child planned once.
    const inner = planOf(op.of, leaves);
    if (!inner) return undefined;
    const leaf = leaves.length;
    leaves.push({ kind: "repeat", operand: op });
    return {
      node: { kind: "repeat", leaf, of: inner.node },
      shape: `polarRepeat(${inner.shape})`,
    };
  }
  if (isCsgOperand(op)) {
    const kids: FieldNodePlan[] = [];
    const shapes: string[] = [];
    for (const child of op.of) {
      const planned = planOf(child, leaves);
      if (!planned) return undefined;
      kids.push(planned.node);
      shapes.push(planned.shape);
    }
    return { node: { kind: op.op, of: kids }, shape: `${op.op}(${shapes.join(",")})` };
  }
  return undefined;
}

function isCsgOperand(op: CsgOperand): op is Csg2 {
  return op.kind === "csg2" && op.of.length > 0;
}

function addLeaf(leaves: FieldLeafPlan[], leaf: FieldLeafPlan): FieldNodePlan {
  const index = leaves.length;
  leaves.push(leaf);
  return { kind: "leaf", leaf: index };
}

/** Leaf data for a plan — the CPU twin of what the adapter uploads. */
export function buildFieldInstance(plan: FieldPlan): FieldInstance {
  const spans = emptySpans();
  const leaves = plan.leaves.map((leaf): FieldLeafData => {
    if (leaf.kind === "spans") {
      const block = islandSpans(leaf.operand);
      const segOffset = spans.segs.length;
      const arcOffset = spans.arcs.length;
      spans.segs.push(...block.segs);
      spans.arcs.push(...block.arcs);
      return {
        a: ORIGIN,
        b: ORIGIN,
        r: 0,
        segOffset,
        segCount: block.segs.length,
        arcOffset,
        arcCount: block.arcs.length,
      };
    }
    if (leaf.kind === "circle") {
      return { a: leaf.operand.center, b: ORIGIN, r: Math.abs(leaf.operand.radius), ...NO_SPANS };
    }
    if (leaf.kind === "halfPlane") {
      const { origin, dir } = lineBasis(leaf.operand.line);
      return { a: origin, b: mul(perp(dir), -leaf.operand.side), r: 0, ...NO_SPANS };
    }
    if (leaf.kind === "repeat") {
      const rep = leaf.operand;
      return {
        a: rep.about,
        // The fold only needs the spin and the spacing; the count rides along
        // because the box and the CPU twin read it.
        b: { x: rep.rotation, y: repeatStep(rep.count) },
        r: rep.count,
        ...NO_SPANS,
      };
    }
    return { a: ORIGIN, b: ORIGIN, r: leaf.operand.d, ...NO_SPANS };
  });
  return { leaves, spans };
}

/** Superset box for the whole field (a half-plane makes it unbounded; the
 * caller clamps to the visible rect). Every boolean unions its operands and an
 * offset inflates, so the quad always covers the field's inside. */
export function fieldBox(plan: FieldPlan, inst: FieldInstance): Box {
  return nodeBox(plan.root, plan, inst);
}

function nodeBox(node: FieldNodePlan, plan: FieldPlan, inst: FieldInstance): Box {
  if (node.kind === "leaf") {
    return leafBox(plan.leaves[node.leaf]!, inst.leaves[node.leaf]!, inst.spans);
  }
  if (node.kind === "repeat") {
    const inner = nodeBox(node.of, plan, inst);
    if (!Number.isFinite(inner.min.x)) return UNBOUNDED;
    const leaf = inst.leaves[node.leaf]!;
    return repeatBox(inner, leaf.a, leaf.b.x, leaf.b.y, leaf.r);
  }
  if (node.kind === "offset") {
    const inner = nodeBox(node.of, plan, inst);
    const d = Math.abs(inst.leaves[node.leaf]!.r);
    return {
      min: { x: inner.min.x - d, y: inner.min.y - d },
      max: { x: inner.max.x + d, y: inner.max.y + d },
    };
  }
  let box: Box | undefined;
  for (const child of node.of) box = unionBox(box, nodeBox(child, plan, inst));
  return box ?? UNBOUNDED;
}

function leafBox(leaf: FieldLeafPlan, data: FieldLeafData, spans: SpanSet): Box {
  if (leaf.kind === "halfPlane") return UNBOUNDED;
  if (leaf.kind === "circle") {
    const r = data.r;
    return {
      min: { x: data.a.x - r, y: data.a.y - r },
      max: { x: data.a.x + r, y: data.a.y + r },
    };
  }
  const box = newBox();
  growSpanBox(box, spans, data);
  return box;
}

/** Box of the copies: every rotated corner of the child's box, unioned. Exact
 * for the copies' *boxes* (the shapes inside only get closer to the axis), and a
 * superset of the field. Above `MAX_BOX_COPIES` the disc through the farthest
 * corner stands in, which is also a superset — the quad is only a rasterization
 * hint, so a superset costs fragments and never correctness. */
function repeatBox(box: Box, about: Vec2, rotation: number, step: number, count: number): Box {
  if (!(count > MAX_BOX_COPIES)) {
    const out = newBox();
    for (let k = 0; k < count; k++) {
      const ang = rotation + k * step;
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      for (const corner of [
        { x: box.min.x, y: box.min.y },
        { x: box.max.x, y: box.min.y },
        { x: box.max.x, y: box.max.y },
        { x: box.min.x, y: box.max.y },
      ]) {
        const vx = corner.x - about.x;
        const vy = corner.y - about.y;
        grow(out, { x: about.x + vx * c - vy * s, y: about.y + vx * s + vy * c });
      }
    }
    if (Number.isFinite(out.min.x)) return out;
  }
  const r = Math.max(
    Math.hypot(box.min.x - about.x, box.min.y - about.y),
    Math.hypot(box.max.x - about.x, box.min.y - about.y),
    Math.hypot(box.max.x - about.x, box.max.y - about.y),
    Math.hypot(box.min.x - about.x, box.max.y - about.y),
  );
  return {
    min: { x: about.x - r, y: about.y - r },
    max: { x: about.x + r, y: about.y + r },
  };
}

const MAX_BOX_COPIES = 64;

const UNBOUNDED: Box = {
  min: { x: -Infinity, y: -Infinity },
  max: { x: Infinity, y: Infinity },
};

function unionBox(a: Box | undefined, b: Box): Box {
  if (!a) return b;
  return {
    min: { x: Math.min(a.min.x, b.min.x), y: Math.min(a.min.y, b.min.y) },
    max: { x: Math.max(a.max.x, b.max.x), y: Math.max(a.max.y, b.max.y) },
  };
}
