import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import type { CsgOperand, Region, Vec2 } from "#geom";
import { isFillGeom } from "#geom/csg2";
import { operandAabb, operandSdf, polarRepeatValue } from "#geom/csg2";

import { evaluate } from "../../../eval/evaluate";
import type { Scene } from "../../../eval/scene";
import { analyze, type Annotation } from "../../../source/analyze";
import { mergeAnnotationBundle } from "../../../source/catalog";
import { evaluateField } from "./eval";
import {
  buildFieldInstance,
  fieldBox,
  fieldPlan,
  type FieldInstance,
  type FieldPlan,
} from "./plan";

const demoSrc = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../../apps/demo/src",
);

/** Every scene with a fill in it (the demo set the GPU pane actually runs). */
const SCENES = [
  "arcade",
  "cache-lab",
  "csg-tree",
  "fillet",
  "gear",
  "islands",
  "mounting-plate",
  "mounting-plate-grid",
  "pie",
  "round-offset",
  "stock-cutters",
  "truss",
];

type Case = { scene: string; bind: string; value: CsgOperand; plan: FieldPlan };

function sceneTrace(mod: Scene, name: string) {
  const rel = `apps/demo/src/scenes/${name}.ts`;
  const src = readFileSync(path.join(demoSrc, rel.replace(/^apps\/demo\/src\//, "")), "utf8");
  const bundle: Record<string, Record<string, Annotation>> = {
    [rel]: Object.fromEntries(analyze(src, rel)),
  };
  return evaluate(mod, { annotations: mergeAnnotationBundle(bundle) }).trace;
}

async function csgCases(): Promise<Case[]> {
  const cases: Case[] = [];
  for (const name of SCENES) {
    const mod = (await import(`../../../../../../apps/demo/src/scenes/${name}.ts`)) as {
      default: Scene;
    };
    for (const n of sceneTrace(mod.default, name)) {
      if (!isFillGeom(n.value) || n.value.kind !== "csg2") continue;
      const plan = fieldPlan(n.value as CsgOperand);
      if (!plan) continue;
      cases.push({ scene: name, bind: n.bind ?? n.id, value: n.value as CsgOperand, plan });
    }
  }
  return cases;
}

/** Finite probe rect: the union of the finite leaves (half-planes are a clip,
 * so probing the finite part is enough to catch a field slip). */
function probeRect(plan: FieldPlan, inst: ReturnType<typeof buildFieldInstance>) {
  let min = { x: Infinity, y: Infinity };
  let max = { x: -Infinity, y: -Infinity };
  const seen = new Set<number>();
  const walk = (node: FieldPlan["root"]): void => {
    if (node.kind === "offset" || node.kind === "repeat") return walk(node.of);
    if (node.kind !== "leaf") {
      for (const child of node.of) walk(child);
      return;
    }
    if (seen.has(node.leaf)) return;
    seen.add(node.leaf);
    const leaf = plan.leaves[node.leaf]!;
    if (leaf.kind === "halfPlane") return;
    const box = fieldBox({ ...plan, root: node }, inst);
    if (!Number.isFinite(box.min.x)) return;
    min = { x: Math.min(min.x, box.min.x), y: Math.min(min.y, box.min.y) };
    max = { x: Math.max(max.x, box.max.x), y: Math.max(max.y, box.max.y) };
  };
  walk(plan.root);
  if (!Number.isFinite(min.x)) return undefined;
  const padX = Math.max(0.5, (max.x - min.x) * 0.15);
  const padY = Math.max(0.5, (max.y - min.y) * 0.15);
  return {
    min: { x: min.x - padX, y: min.y - padY },
    max: { x: max.x + padX, y: max.y + padY },
  };
}

/** Mutate every number a field leaf reads (never the tree's shape). */
function nudgeLeafData(op: CsgOperand): void {
  const v = op as { kind: string } & Record<string, unknown>;
  if (v.kind === "circle") v.radius = (v.radius as number) * 1.37;
  if (v.kind === "offset") v.d = (v.d as number) + 0.21;
  if (v.kind === "region") {
    const edges = (v.outer as { a: Vec2 }[]) ?? [];
    for (const e of edges) e.a = { x: e.a.x + 0.3, y: e.a.y - 0.2 };
  }
  const of = v.of as CsgOperand[] | CsgOperand | undefined;
  if (Array.isArray(of)) for (const child of of) nudgeLeafData(child);
  else if (of && typeof of === "object") nudgeLeafData(of);
}

const GRID = 21;
/** Cell-centred grid nudged off exact axis alignment: a probe lying exactly on
 * a straight edge is a measure-zero degeneracy where the winding rules choose
 * differently (the span fill shader has it too), so it is not sampled. */
const JITTER = 0.371;

/** Probes: a nudged grid over the node's box, plus both sides of every span's
 * midpoint — the boundary sign that actually matters. Segments and arcs share
 * the probe (an arc's chord midpoint is still a boundary neighbourhood). */
function probesFor(rect: { min: Vec2; max: Vec2 }, inst: FieldInstance): Vec2[] {
  const out: Vec2[] = [];
  const w = rect.max.x - rect.min.x;
  const h = rect.max.y - rect.min.y;
  for (let iy = 0; iy < GRID; iy++) {
    for (let ix = 0; ix < GRID; ix++) {
      out.push({
        x: rect.min.x + (w * (ix + JITTER)) / (GRID - 1),
        y: rect.min.y + (h * (iy + JITTER)) / (GRID - 1),
      });
    }
  }
  for (const e of [...inst.spans.segs, ...inst.spans.arcs]) {
    const mx = (e.a.x + e.b.x) / 2;
    const my = (e.a.y + e.b.y) / 2;
    const tx = e.b.x - e.a.x;
    const ty = e.b.y - e.a.y;
    const len = Math.hypot(tx, ty) || 1;
    const nx = -ty / len;
    const ny = tx / len;
    for (const h2 of [1e-3, 1e-2, 0.05]) {
      out.push({ x: mx + nx * h2, y: my + ny * h2 });
      out.push({ x: mx - nx * h2, y: my - ny * h2 });
    }
  }
  return out;
}
/** The CPU reference is chord-based: `walkContains` poly-tests `tessellateWalk`,
 * whose chords deviate from the true arc by at most r(1−cos(π/48)) ≈ 0.00215r.
 * Inside that band the compiled field (exact arcs) and the reference are allowed
 * to disagree — the field is the more accurate of the two. Everything outside
 * the band must agree to the tolerance below. */
const BAND_FACTOR = 0.005;

/** A tooth-like box on the `+x` side of the origin: cell 0 for `polarRepeat`. */
function ringTooth(): Region {
  const corners: Vec2[] = [
    { x: 1.8, y: -0.3 },
    { x: 2.2, y: -0.3 },
    { x: 2.2, y: 0.3 },
    { x: 1.8, y: 0.3 },
  ];
  const outer = corners.map((a, i) => {
    const b = corners[(i + 1) % corners.length]!;
    return { a, b, carrier: { kind: "segment" as const, a, b } };
  });
  return { kind: "region", outer, holes: [] };
}

function arcBand(inst: FieldInstance): number {
  let r = 0;
  for (const e of inst.spans.arcs) if (e.radius > r) r = e.radius;
  return r > 0 ? BAND_FACTOR * r : 1e-9;
}

describe("field plan", () => {
  test("every demo CSG fill compiles, and the shapes collapse hard", async () => {
    const cases = await csgCases();
    expect(cases.length).toBeGreaterThan(20);
    const shapes = new Map<string, number>();
    for (const c of cases) shapes.set(c.plan.shape, (shapes.get(c.plan.shape) ?? 0) + 1);
    // Leaves are data: no number ever reaches the key.
    for (const shape of shapes.keys()) {
      expect(shape).toMatch(/^[a-z]+([(),a-zA-Z]*)$/);
      expect(shape).not.toMatch(/\d/);
    }
    // eslint-disable-next-line no-console
    console.log(
      `${cases.length} CSG fills → ${shapes.size} shapes:\n` +
        [...shapes].map(([s, n]) => `  ${n}× ${s}`).join("\n"),
    );
    expect(shapes.size).toBeLessThan(cases.length);
  });

  test("leaf data changes never move the shape", async () => {
    const cases = await csgCases();
    for (const c of cases) {
      const moved = JSON.parse(JSON.stringify(c.value)) as CsgOperand;
      nudgeLeafData(moved);
      const replanned = fieldPlan(moved);
      expect(replanned?.shape).toBe(c.plan.shape);
    }
  });

  test("a polar repeat compiles to one leaf of numbers over the child's tree", () => {
    const rep = polarRepeatValue(ringTooth(), 12, { x: 0, y: 0 }, 0.4);
    const plan = fieldPlan(rep)!;
    expect(plan).toBeDefined();
    // Structure only: the count and the spin are data, so the cache key holds
    // neither, and a slider drag cannot recompile the shader.
    expect(plan.shape).toBe("polarRepeat(region)");
    // The child is planned first (like `offset`), so the wrapper's leaf is last.
    expect(plan.leaves.map((l) => l.kind)).toEqual(["spans", "repeat"]);
    const other = fieldPlan(polarRepeatValue(ringTooth(), 37, { x: 5, y: -2 }, -1.7))!;
    expect(other.shape).toBe(plan.shape);
    expect(other.leaves).toHaveLength(2);

    // Leaf data is where those numbers live: `a` is the axis, `b` the spin and
    // the spacing, `r` the count the CPU twin and the box read.
    const inst = buildFieldInstance(plan);
    const rep2 = inst.leaves[1]!;
    expect(rep2.a).toEqual({ x: 0, y: 0 });
    expect(rep2.b.x).toBeCloseTo(0.4, 12);
    expect(rep2.b.y).toBeCloseTo((2 * Math.PI) / 12, 12);
    expect(rep2.r).toBe(12);
    // One window into the span arrays: the tooth, not the ring.
    expect(inst.leaves[0]!.segCount).toBe(4);
    expect(inst.spans.segs).toHaveLength(4);
  });

  test("the compiled fold matches the reference across the ring", () => {
    const rep = polarRepeatValue(ringTooth(), 12, { x: 0, y: 0 }, 0.4);
    const plan = fieldPlan(rep)!;
    const inst = buildFieldInstance(plan);
    let worst = 0;
    let at: Vec2 = { x: 0, y: 0 };
    for (let i = 0; i <= 120; i++) {
      for (let j = 0; j <= 120; j++) {
        const p = { x: -3.4 + (6.8 * i) / 120, y: -3.4 + (6.8 * j) / 120 };
        const delta = Math.abs(evaluateField(plan, inst, p) - operandSdf(rep, p));
        if (delta > worst) {
          worst = delta;
          at = p;
        }
      }
    }
    expect(worst, `worst Δ at ${JSON.stringify(at)}`).toBeLessThan(1e-9);

    // The quad covers every copy, and agrees with the CPU box.
    const box = fieldBox(plan, inst);
    const want = operandAabb(rep)!;
    expect(box.min.x).toBeCloseTo(want.minX, 9);
    expect(box.min.y).toBeCloseTo(want.minY, 9);
    expect(box.max.x).toBeCloseTo(want.maxX, 9);
    expect(box.max.y).toBeCloseTo(want.maxY, 9);
    expect(box.max.x).toBeGreaterThan(2);
  });

  test("parity with operandSdf on every demo CSG tree", async () => {
    const cases = await csgCases();
    let probes = 0;
    let inBand = 0;
    let worstInside = 0;
    let worstOutside = 0;
    const signBreaks: string[] = [];
    const breaks: string[] = [];
    for (const c of cases) {
      const inst = buildFieldInstance(c.plan);
      const rect = probeRect(c.plan, inst);
      if (!rect) continue;
      const band = arcBand(inst);
      for (const p of probesFor(rect, inst)) {
        const cpu = operandSdf(c.value, p);
        const gpu = evaluateField(c.plan, inst, p);
        if (!Number.isFinite(cpu) || !Number.isFinite(gpu)) continue;
        probes++;
        if (Math.abs(cpu) <= band) {
          inBand++;
          continue;
        }
        const delta = Math.abs(gpu - cpu);
        if (cpu < 0) worstInside = Math.max(worstInside, delta);
        else worstOutside = Math.max(worstOutside, delta);
        if (cpu < 0 !== gpu < 0) {
          signBreaks.push(
            `${c.scene}.${c.bind} sign at (${p.x},${p.y}) cpu=${cpu} gpu=${gpu} band=${band}`,
          );
        }
        if (delta > band) {
          breaks.push(`${c.scene}.${c.bind} Δ=${delta} at (${p.x},${p.y}) cpu=${cpu} gpu=${gpu}`);
        }
      }
    }
    // eslint-disable-next-line no-console
    console.log(
      `parity: ${probes} probes (${inBand} inside the arc band), worst Δ inside ` +
        `${worstInside.toExponential(2)}, outside ${worstOutside.toExponential(2)}`,
    );
    expect(signBreaks.slice(0, 10)).toEqual([]);
    expect(breaks.slice(0, 10)).toEqual([]);
    expect(inBand / probes).toBeLessThan(0.1);
    expect(worstInside).toBeLessThan(1e-6);
    expect(worstOutside).toBeLessThan(1e-6);
  });
});
