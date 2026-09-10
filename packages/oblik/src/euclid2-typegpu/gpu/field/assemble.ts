import { tgpu } from "typegpu";
import type { TgpuBindGroup, TgpuRenderPipeline, TgpuRoot } from "typegpu";
import { bool, builtin, f32, interpolate, u32, vec2f, vec4f } from "typegpu/data";
import type { v2f } from "typegpu/data";
import { abs, atan2, clamp, dot, floor, length, max, min, sign, sqrt } from "typegpu/std";

import { QUAD_PAD_PX, worldPerPx } from "../frame";
import { fieldLayout } from "../layout";
import { haloWithEdge, paintWithEdge } from "../pipelines/halo";
import type { FieldNodePlan, FieldPlan } from "./plan";

const TAU = 6.283185307179586;
const FAR = 1e30;

/** (world position, leaf window base) → signed distance, negative inside. */
type FieldFn = (p: v2f, base: number) => number;

/**
 * Compiles a `FieldPlan` into TGSL. The tree becomes control flow at **codegen
 * time** — one emitted expression per node, ops folded into `min`/`max` calls —
 * so the only thing left at draw time is data: `base` (the node's leaf window)
 * and the leaf records themselves. Two nodes with the same shape share the
 * emitted WGSL byte for byte (`field/wgsl.test.ts` asserts that), which is why
 * the pipeline cache can key on the shape string alone.
 *
 * This is a direct transcription of `eval.ts`, which is itself checked against
 * the CPU reference (`operandSdf`/`csgSdf`) in `plan.test.ts`.
 */
export function assembleField(plan: FieldPlan): FieldFn {
  return assembleNode(plan, plan.root);
}

function assembleNode(plan: FieldPlan, node: FieldNodePlan): FieldFn {
  if (node.kind === "leaf") return assembleLeaf(plan, node.leaf);
  if (node.kind === "offset") {
    const inner = assembleNode(plan, node.of);
    const index = node.leaf;
    return tgpu.fn(
      [vec2f, u32],
      f32,
    )((p, base) => {
      "use gpu";
      // Round joins fall out of the SDF shift, exactly like `roundOffsetValue`.
      return inner(p, base) - fieldLayout.$.fieldLeaves[base + u32(index)].r;
    });
  }
  const kids = node.of.map((child) => assembleNode(plan, child));
  const first = kids[0];
  if (!first) {
    return tgpu.fn(
      [vec2f, u32],
      f32,
    )(() => {
      "use gpu";
      return f32(FAR);
    });
  }
  // Fold on the CPU: each combine step is its own TGSL closure, so the emitted
  // body is straight-line calls — no runtime loop, no indexed array.
  let acc = first;
  for (const child of kids.slice(1)) acc = combine(node.kind, acc, child);
  return acc;
}

/** One boolean step of a fold. `diff` subtracts the right operand. */
function combine(op: "union" | "intersect" | "diff", a: FieldFn, b: FieldFn): FieldFn {
  if (op === "union") {
    return tgpu.fn(
      [vec2f, u32],
      f32,
    )((p, base) => {
      "use gpu";
      return min(a(p, base), b(p, base));
    });
  }
  if (op === "intersect") {
    return tgpu.fn(
      [vec2f, u32],
      f32,
    )((p, base) => {
      "use gpu";
      return max(a(p, base), b(p, base));
    });
  }
  return tgpu.fn(
    [vec2f, u32],
    f32,
  )((p, base) => {
    "use gpu";
    return max(a(p, base), -b(p, base));
  });
}

function assembleLeaf(plan: FieldPlan, index: number): FieldFn {
  const kind = plan.leaves[index]!.kind;
  if (kind === "circle") {
    return tgpu.fn(
      [vec2f, u32],
      f32,
    )((p, base) => {
      "use gpu";
      const leaf = fieldLayout.$.fieldLeaves[base + u32(index)];
      return length(p - leaf.a) - leaf.r;
    });
  }
  if (kind === "halfPlane") {
    // `b` is the pre-rotated inside normal, so this is `−side · signedDist`.
    return tgpu.fn(
      [vec2f, u32],
      f32,
    )((p, base) => {
      "use gpu";
      const leaf = fieldLayout.$.fieldLeaves[base + u32(index)];
      return dot(p - leaf.a, leaf.b);
    });
  }
  if (kind === "offset") {
    return tgpu.fn(
      [vec2f, u32],
      f32,
    )(() => {
      "use gpu";
      return f32(0);
    });
  }
  return tgpu.fn(
    [vec2f, u32],
    f32,
  )((p, base) => {
    "use gpu";
    return spanWalk(base + u32(index), p);
  });
}

/** Winding + nearest-boundary walk over a leaf's span window — the same loops
 * the span fill pass runs in `pipelines/fills.ts` (non-zero rule). Segments and
 * arcs are separate arrays with separate windows, so neither loop carries a
 * carrier it cannot use: the segment loop is 16 B records end to end. */
const spanWalk = tgpu.fn(
  [u32, vec2f],
  f32,
)((leafIndex, p) => {
  "use gpu";
  const leaf = fieldLayout.$.fieldLeaves[leafIndex];
  let winding = 0;
  let dmin = f32(FAR);
  const segEnd = leaf.segOffset + leaf.segCount;
  for (let i = leaf.segOffset; i < segEnd; i += 1) {
    const e = fieldLayout.$.fieldSegs[i];
    const ab = e.b - e.a;
    const ap = p - e.a;
    const denom = dot(ab, ab);
    const t = clamp(denom > 0 ? dot(ap, ab) / denom : 0, 0, 1);
    dmin = min(dmin, length(ap - ab * t));
    if (e.a.y > p.y !== e.b.y > p.y) {
      const xint = e.a.x + ((p.y - e.a.y) * (e.b.x - e.a.x)) / (e.b.y - e.a.y);
      if (xint > p.x) winding += e.b.y > e.a.y ? 1 : -1;
    }
  }
  const arcEnd = leaf.arcOffset + leaf.arcCount;
  for (let i = leaf.arcOffset; i < arcEnd; i += 1) {
    const e = fieldLayout.$.fieldArcs[i];
    const k = sign(e.span);
    const absSpan = abs(e.span);
    const full = absSpan >= TAU;
    const a0 = atan2(e.a.y - e.center.y, e.a.x - e.center.x);
    const v = p - e.center;
    const dist = length(v);
    if (withinArc(atan2(v.y, v.x), k, a0, absSpan, full)) {
      dmin = min(dmin, abs(dist - e.radius));
    } else {
      dmin = min(dmin, min(length(p - e.a), length(p - e.b)));
    }
    if (abs(v.y) < e.radius) {
      const dx = sqrt(e.radius * e.radius - v.y * v.y);
      let s = f32(-1);
      while (true) {
        const cx = e.center.x + s * dx;
        if (cx > p.x && withinArc(atan2(v.y, s * dx), k, a0, absSpan, full)) {
          winding += (e.span > 0 ? 1 : -1) * (s > 0 ? 1 : -1);
        }
        if (s === f32(1)) break;
        s = f32(1);
      }
    }
  }
  return winding === 0 ? dmin : -dmin;
});

/** Angular inside-test for an arc span; TGSL has no closures, so this is a
 * module-level fn rather than an inline arrow. */
const withinArc = tgpu.fn(
  [f32, f32, f32, f32, bool],
  bool,
)((q, k, a0, absSpan, full) => {
  "use gpu";
  if (full) return true;
  let t = k > 0 ? q - a0 : a0 - q;
  t = t - floor(t / TAU) * TAU;
  return t <= absSpan;
});

/** World → clip, same mapping as the other pipelines. */
const toClip = tgpu.fn(
  [vec2f],
  vec4f,
)((p) => {
  "use gpu";
  const f = fieldLayout.$.frame;
  const k = vec2f((f.scale * 2) / max(1, f.pane.x), (f.scale * 2) / max(1, f.pane.y));
  return vec4f(k * (p - f.cam), 0, 1);
});

/** The field quad: one AABB triangle-strip per compiled node. */
export const fieldVertex = tgpu.vertexFn({
  in: { instanceIndex: builtin.instanceIndex, vertexIndex: builtin.vertexIndex },
  out: {
    outPos: builtin.position,
    p: interpolate("linear", vec2f),
    quad: interpolate("flat", u32),
  },
})(({ instanceIndex, vertexIndex }) => {
  "use gpu";
  const slot = fieldLayout.$.fieldOrder[instanceIndex];
  const q = fieldLayout.$.fieldQuads[slot];
  // Same split as the span pass: the AABB is world geometry, the AA skirt is a
  // CSS-px width applied at draw time, so the record holds no camera.
  const pad = QUAD_PAD_PX * worldPerPx(fieldLayout.$.frame.scale);
  const x = vertexIndex === 1 || vertexIndex === 3 ? q.aabbMax.x + pad : q.aabbMin.x - pad;
  const y = vertexIndex >= 2 ? q.aabbMax.y + pad : q.aabbMin.y - pad;
  return { outPos: toClip(vec2f(x, y)), p: vec2f(x, y), quad: slot };
});

/** Corner vertices per field quad instance. */
export const FIELD_QUAD_VERTICES = 4;

/** Which layer a compiled field is drawn as: the fill, or its inward halo band
 * (the same evaluated distance, a different output — see `pipelines/halo.ts`). */
export type FieldLayer = "paint" | "halo";

/** Fragment entry for a plan in a given layer — builds (does not cache) the
 * compiled artifact. Both layers share one `assembleField` result, so the tree
 * is evaluated once per shape however many layers the cache asks for. */
export function fieldFragment(plan: FieldPlan, layer: FieldLayer = "paint") {
  const evaluate = assembleField(plan);
  if (layer === "halo") {
    return tgpu.fragmentFn({
      in: { p: interpolate("linear", vec2f), quad: interpolate("flat", u32) },
      out: vec4f,
    })(({ p, quad }) => {
      "use gpu";
      const q = fieldLayout.$.fieldQuads[quad];
      const w = worldPerPx(fieldLayout.$.frame.scale);
      return haloWithEdge(
        evaluate(p, q.leafBase),
        q.haloRing,
        q.haloKnock,
        q.haloHalfPx * w,
        q.edge,
        q.edgeWidthPx * w,
      );
    });
  }
  return tgpu.fragmentFn({
    in: { p: interpolate("linear", vec2f), quad: interpolate("flat", u32) },
    out: vec4f,
  })(({ p, quad }) => {
    "use gpu";
    const q = fieldLayout.$.fieldQuads[quad];
    return paintWithEdge(
      evaluate(p, q.leafBase),
      vec4f(q.color, q.alpha),
      q.edge,
      q.edgeWidthPx * worldPerPx(fieldLayout.$.frame.scale),
    );
  });
}

// -- compiled artifacts ------------------------------------------------------

/** The compiled fragment's type, inferred from the entry point itself. */
export type FieldFragment = ReturnType<typeof fieldFragment>;

/** Fragment entry per (shape, layer): the TGSL assembly and its WGSL, once. */
const fragments = new Map<string, FieldFragment>();

export function fieldFragmentFor(plan: FieldPlan, layer: FieldLayer = "paint"): FieldFragment {
  const key = `${plan.shape}|${layer}`;
  const hit = fragments.get(key);
  if (hit) return hit;
  const built = fieldFragment(plan, layer);
  fragments.set(key, built);
  return built;
}

/** Pipelines per (bind group, shape, layer, target): the shape and layer pick
 * the fragment, the bind group picks the buffers, so a band, a shape and a
 * layer each pay once. */
const pipelines = new WeakMap<TgpuBindGroup, Map<string, TgpuRenderPipeline>>();

export function fieldPipeline(
  root: TgpuRoot,
  bindGroup: TgpuBindGroup,
  plan: FieldPlan,
  format: GPUTextureFormat,
  samples: number,
  layer: FieldLayer = "paint",
): TgpuRenderPipeline {
  const key = `${plan.shape}|${layer}|${format}|${samples}`;
  let perGroup = pipelines.get(bindGroup);
  if (!perGroup) {
    perGroup = new Map();
    pipelines.set(bindGroup, perGroup);
  }
  const hit = perGroup.get(key);
  if (hit) return hit;
  const blend: GPUBlendState = {
    color: { operation: "add", srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha" },
    alpha: { operation: "add", srcFactor: "one", dstFactor: "one" },
  };
  const pipeline = root
    .createRenderPipeline({
      vertex: fieldVertex,
      fragment: fieldFragmentFor(plan, layer),
      targets: { format, blend },
      primitive: { topology: "triangle-strip" },
      multisample: { count: samples },
    })
    .with(bindGroup);
  perGroup.set(key, pipeline);
  return pipeline;
}
