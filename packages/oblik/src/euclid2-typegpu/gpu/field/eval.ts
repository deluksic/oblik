import type { Vec2 } from "#geom";

import type { FieldInstance, FieldNodePlan, FieldPlan, FieldLeafData } from "./plan";

/**
 * The TS twin of the compiled field shader — same expressions, same order, so
 * `eval.ts` and the TGSL assembly in `../csgField.ts` can only differ by a
 * transcription slip. `plan.test.ts` checks this one against the CPU reference
 * (`operandSdf`/`csgSdf` in `geom/csg2.ts`) on every demo CSG tree.
 *
 * Sign convention (both sides): **negative is inside**.
 */

const TAU = Math.PI * 2;
const FAR = 1e30;

export function evaluateField(plan: FieldPlan, inst: FieldInstance, p: Vec2): number {
  return evalNode(plan, plan.root, inst, p);
}

function evalNode(plan: FieldPlan, node: FieldNodePlan, inst: FieldInstance, p: Vec2): number {
  if (node.kind === "leaf") return evalLeaf(plan, node.leaf, inst, p);
  if (node.kind === "offset") {
    return evalNode(plan, node.of, inst, p) - inst.leaves[node.leaf]!.r;
  }
  if (node.kind === "repeat") {
    // Fold into the nearest copy, then evaluate the child there. Transcribed from
    // the shader's own fold (`../assemble.ts`) rather than calling the shared
    // helper, on purpose: this file is the shader's mirror, so the parity run
    // against `operandSdf` has to see the shader's arithmetic, not a second copy
    // of the reference. (`geom/repeat.ts`'s `foldPolar` is that reference.)
    const leaf = inst.leaves[node.leaf]!;
    const theta = Math.atan2(p.y - leaf.a.y, p.x - leaf.a.x);
    const ang = leaf.b.x + Math.round((theta - leaf.b.x) / leaf.b.y) * leaf.b.y;
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const vx = p.x - leaf.a.x;
    const vy = p.y - leaf.a.y;
    return evalNode(plan, node.of, inst, {
      x: leaf.a.x + vx * c + vy * s,
      y: leaf.a.y + vy * c - vx * s,
    });
  }
  const first = node.of[0];
  if (!first) return Number.NaN;
  if (node.kind === "diff") {
    let d = evalNode(plan, first, inst, p);
    for (let i = 1; i < node.of.length; i++) {
      d = Math.max(d, -evalNode(plan, node.of[i]!, inst, p));
    }
    return d;
  }
  let d = evalNode(plan, first, inst, p);
  for (let i = 1; i < node.of.length; i++) {
    const b = evalNode(plan, node.of[i]!, inst, p);
    d = node.kind === "union" ? Math.min(d, b) : Math.max(d, b);
  }
  return d;
}

function evalLeaf(plan: FieldPlan, index: number, inst: FieldInstance, p: Vec2): number {
  const leaf = plan.leaves[index]!;
  const data = inst.leaves[index]!;
  if (leaf.kind === "circle") return Math.hypot(p.x - data.a.x, p.y - data.a.y) - data.r;
  // Half-plane: `b` is the pre-rotated inside normal, so this is `−side · signedDist`.
  if (leaf.kind === "halfPlane") {
    return (p.x - data.a.x) * data.b.x + (p.y - data.a.y) * data.b.y;
  }
  // `offset` and `repeat` are node wrappers: the leaf contributes no field.
  if (leaf.kind === "offset" || leaf.kind === "repeat") return 0;
  return spanField(inst, data, p);
}

/** Winding + nearest-boundary walk over a leaf's span window — the same loops
 * the span fill pass runs (`pipelines/fills.ts`), and the same ones the field
 * shader inlines for a `spans` leaf: straight records first, then arcs. */
export function spanField(inst: FieldInstance, window: FieldLeafData, p: Vec2): number {
  let winding = 0;
  let dmin = FAR;
  const segEnd = window.segOffset + window.segCount;
  for (let i = window.segOffset; i < segEnd; i++) {
    const e = inst.spans.segs[i]!;
    const abx = e.b.x - e.a.x;
    const aby = e.b.y - e.a.y;
    const apx = p.x - e.a.x;
    const apy = p.y - e.a.y;
    const denom = abx * abx + aby * aby;
    const t = clamp(denom > 0 ? (apx * abx + apy * aby) / denom : 0, 0, 1);
    dmin = Math.min(dmin, Math.hypot(apx - abx * t, apy - aby * t));
    if (e.a.y > p.y !== e.b.y > p.y) {
      const xint = e.a.x + ((p.y - e.a.y) * (e.b.x - e.a.x)) / (e.b.y - e.a.y);
      if (xint > p.x) winding += e.b.y > e.a.y ? 1 : -1;
    }
  }
  const arcEnd = window.arcOffset + window.arcCount;
  for (let i = window.arcOffset; i < arcEnd; i++) {
    const e = inst.spans.arcs[i]!;
    const k = Math.sign(e.span);
    const absSpan = Math.abs(e.span);
    const full = absSpan >= TAU;
    const a0 = Math.atan2(e.a.y - e.center.y, e.a.x - e.center.x);
    const vx = p.x - e.center.x;
    const vy = p.y - e.center.y;
    const dist = Math.hypot(vx, vy);
    if (withinArc(Math.atan2(vy, vx), k, a0, absSpan, full)) {
      dmin = Math.min(dmin, Math.abs(dist - e.radius));
    } else {
      dmin = Math.min(
        dmin,
        Math.hypot(p.x - e.a.x, p.y - e.a.y),
        Math.hypot(p.x - e.b.x, p.y - e.b.y),
      );
    }
    if (Math.abs(vy) < e.radius) {
      const dx = Math.sqrt(e.radius * e.radius - vy * vy);
      for (const s of [-1, 1]) {
        const cx = e.center.x + s * dx;
        if (cx > p.x && withinArc(Math.atan2(vy, s * dx), k, a0, absSpan, full)) {
          winding += (e.span > 0 ? 1 : -1) * (s > 0 ? 1 : -1);
        }
      }
    }
  }
  return winding === 0 ? dmin : -dmin;
}

function withinArc(q: number, k: number, a0: number, absSpan: number, full: boolean): boolean {
  if (full) return true;
  let t = k > 0 ? q - a0 : a0 - q;
  t = t - Math.floor(t / TAU) * TAU;
  return t <= absSpan;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Convenience for probes: is the field inside at `p`? */
export function fieldInside(plan: FieldPlan, inst: FieldInstance, p: Vec2): boolean {
  return evaluateField(plan, inst, p) < 0;
}
