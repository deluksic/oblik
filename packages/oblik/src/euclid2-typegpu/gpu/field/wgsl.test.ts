import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { tgpu } from "typegpu";
import { describe, expect, test } from "vitest";

import { walkEdges } from "#geom/region";

import type { CsgOperand, Region, Vec2 } from "#geom";
import { isFillGeom, polarRepeatValue } from "#geom/csg2";

import { evaluate } from "../../../eval/evaluate";
import type { Scene } from "../../../eval/scene";
import { analyze, type Annotation } from "../../../source/analyze";
import { mergeAnnotationBundle } from "../../../source/catalog";
import { fieldFragment } from "./assemble";
import { fieldPlan, type FieldNodePlan, type FieldPlan } from "./plan";

const demoSrc = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../../apps/demo/src",
);

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

async function csgCases(): Promise<Case[]> {
  const cases: Case[] = [];
  for (const name of SCENES) {
    const rel = `apps/demo/src/scenes/${name}.ts`;
    const src = readFileSync(path.join(demoSrc, rel.replace(/^apps\/demo\/src\//, "")), "utf8");
    const bundle: Record<string, Record<string, Annotation>> = {
      [rel]: Object.fromEntries(analyze(src, rel)),
    };
    const mod = (await import(`../../../../../../apps/demo/src/scenes/${name}.ts`)) as {
      default: Scene;
    };
    const trace = evaluate(mod.default, { annotations: mergeAnnotationBundle(bundle) }).trace;
    for (const n of trace) {
      if (!isFillGeom(n.value) || n.value.kind !== "csg2") continue;
      const plan = fieldPlan(n.value);
      if (plan)
        cases.push({ scene: name, bind: n.bind ?? n.id, value: n.value, plan });
    }
  }
  return cases;
}

/** Rewrite every number a field leaf reads, leaving the tree's shape alone. */
/** A tooth-like box on the `+x` side of the origin: cell 0 of a repeat. */
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

function nudgeLeafData(op: CsgOperand, k: number): void {
  if (op.kind === "circle") op.radius *= k;
  if (op.kind === "offset") {
    op.d += k;
    nudgeLeafData(op.of, k);
  }
  if (op.kind === "region") {
    for (const e of walkEdges(op.outer)) e.a = { x: e.a.x + k, y: e.a.y - k };
  }
  if (op.kind === "csg2") for (const child of op.of) nudgeLeafData(child, k);
  if (op.kind === "pick") nudgeLeafData(op.of, k);
  if (op.kind === "polarRepeat") nudgeLeafData(op.of, k);
}

function countLeaves(node: FieldNodePlan): number {
  if (node.kind === "leaf") return 1;
  if (node.kind === "offset") return countLeaves(node.of) + 1;
  if (node.kind === "repeat") return countLeaves(node.of) + 1;
  return node.of.reduce((sum, child) => sum + countLeaves(child), 0);
}

/** One combine call per operand beyond the first, folded at codegen time. */
function countFolds(node: FieldNodePlan): number {
  if (node.kind === "leaf") return 0;
  if (node.kind === "offset") return countFolds(node.of);
  if (node.kind === "repeat") return countFolds(node.of);
  return node.of.length - 1 + node.of.reduce((sum, child) => sum + countFolds(child), 0);
}

function countSpanLeaves(plan: FieldPlan, node: FieldNodePlan = plan.root): number {
  if (node.kind === "leaf") return plan.leaves[node.leaf]!.kind === "spans" ? 1 : 0;
  if (node.kind === "offset") return countSpanLeaves(plan, node.of);
  if (node.kind === "repeat") return countSpanLeaves(plan, node.of);
  return node.of.reduce((sum, child) => sum + countSpanLeaves(plan, child), 0);
}

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe("compiled field WGSL", () => {
  test("every demo shape resolves; leaves are comptime offsets, the tree never loops", async () => {
    const cases = await csgCases();
    const seen = new Map<string, string>();
    for (const c of cases) {
      // Both layers of every shape: the halo is the same compiled evaluation
      // with a band output, so it must inherit the whole structure below.
      for (const layer of ["paint", "halo"] as const) {
        const key = `${c.plan.shape}|${layer}`;
        let code = seen.get(key);
        if (code === undefined) {
          code = tgpu.resolve([fieldFragment(c.plan, layer)]);
          seen.set(key, code);
        }
        // A fragment entry plus its helpers, with no unresolved placeholders.
        expect(code).toContain("@fragment fn");
        expect(code).not.toContain("undefined");
        // Scalar leaves are read at a literal offset from the node's leaf window;
        // a `spans` leaf hands that same offset to the shared walk instead.
        const spanLeaves = countSpanLeaves(c.plan);
        expect(occurrences(code, "fieldLeaves[(base + ")).toBe(
          countLeaves(c.plan.root) - spanLeaves,
        );
        expect(occurrences(code, "spanWalk((base + ")).toBe(spanLeaves);
        // The only runtime loops are the shared span walk's two — one per record
        // kind; the tree itself is straight-line calls, which is the whole point
        // of compiling it.
        const spanLoops = spanLeaves > 0 ? 2 : 0;
        expect(occurrences(code, "for (var")).toBe(spanLoops);
        expect(occurrences(code, "fieldSegs[")).toBe(spanLoops > 0 ? 1 : 0);
        expect(occurrences(code, "fieldArcs[")).toBe(spanLoops > 0 ? 1 : 0);
        // The segment loop is endpoints only: no carrier, no trigonometry, no
        // square root — that is what the split buys on the heaviest fills. An
        // empty slice (no spans leaf at all) passes vacuously.
        const segLoop = code.slice(code.indexOf("fieldSegs["), code.indexOf("fieldArcs["));
        expect(segLoop).not.toMatch(/atan2|sqrt|radius/);
        // The halo layer samples the node's band; the paint layer never does.
        const haloReads = layer === "halo" ? 1 : 0;
        expect(occurrences(code, "(*q).haloRing")).toBe(haloReads);
        expect(occurrences(code, "(*q).haloKnock")).toBe(haloReads);
        expect(occurrences(code, "(*q).haloHalfPx")).toBe(haloReads);
        // Band and outline widths are px in the record and scaled here, like
        // every other chrome width (see `pipelines/wgsl.test.ts`).
        expect(occurrences(code, "worldPerPx(frame.scale)")).toBe(1);
        const scaled =
          layer === "halo"
            ? [occurrences(code, "(*q).haloHalfPx * w"), occurrences(code, "(*q).edgeWidthPx * w")]
            : [0, occurrences(code, "(*q).edgeWidthPx * worldPerPx(frame.scale)")];
        expect(scaled).toEqual(layer === "halo" ? [1, 1] : [0, 1]);
      }
    }
    expect(seen.size).toBeGreaterThan(5);
  });

  test("a polar repeat folds once instead of expanding its copies", () => {
    // 24 teeth, one tooth of geometry: the fold is one `atan2` + one rotation in
    // front of the child's own walk, and the walk still covers the tooth.
    const rep = polarRepeatValue(ringTooth(), 24, { x: 0, y: 0 }, 0.4);
    const plan = fieldPlan(rep)!;
    const code = tgpu.resolve([fieldFragment(plan)]);
    // One `round` in the whole pipeline: the copy index. The four `atan2` are
    // three in the arc walk plus this one, which is the fold itself.
    expect(occurrences(code, "round(")).toBe(1);
    expect(occurrences(code, "atan2")).toBe(4);
    expect(occurrences(code, "for (var")).toBe(2);
    // The copy index is measured from the spin. Dropping that subtraction (a
    // transcription slip this test exists for) still leaves every loose
    // substring above intact, but lands the pattern on the wrong copies — the
    // ring then renders at `rotation = 0` and nowhere else, so the whole
    // expression is pinned here.
    expect(code).toContain(
      "let ang = ((*leaf).b.x + (round(((atan2((p.y - (*leaf).a.y), (p.x - (*leaf).a.x)) - (*leaf).b.x) / (*leaf).b.y)) * (*leaf).b.y));",
    );
    // The fold's frame is the copy at that angle: rotate the point by −ang.
    expect(code).toContain("(*leaf).a + vec2f(");
    // The count and the spin are leaf data, so a different ring is the same WGSL:
    // dragging a tooth count can never recompile the shader.
    const bigger = fieldPlan(polarRepeatValue(ringTooth(), 37, { x: 9, y: -4 }, -2.2))!;
    expect(tgpu.resolve([fieldFragment(bigger)])).toBe(code);
    // The halo layer inherits the same fold, from the same leaf.
    const halo = tgpu.resolve([fieldFragment(plan, "halo")]);
    expect(halo).toContain(") - (*leaf).b.x) / (*leaf).b.y)");
    expect(occurrences(halo, "round(")).toBe(1);
  });

  test("leaf data never reaches the shader", async () => {
    const cases = await csgCases();
    for (const c of cases) {
      const moved = JSON.parse(JSON.stringify(c.value));
      nudgeLeafData(moved, 1.7);
      const replanned = fieldPlan(moved);
      expect(replanned?.shape).toBe(c.plan.shape);
      // Same shape, wildly different numbers → byte-identical WGSL. This is the
      // guarantee that a drag can never trigger a recompile.
      expect(tgpu.resolve([fieldFragment(replanned!)])).toBe(tgpu.resolve([fieldFragment(c.plan)]));
      // The halo layer holds the same guarantee: it is the same evaluation.
      expect(tgpu.resolve([fieldFragment(replanned!, "halo")])).toBe(
        tgpu.resolve([fieldFragment(c.plan, "halo")]),
      );
    }
  });

  test("different shapes compile to different WGSL", async () => {
    const cases = await csgCases();
    const byShape = new Map<string, string>();
    for (const c of cases) {
      if (!byShape.has(c.plan.shape))
        byShape.set(c.plan.shape, tgpu.resolve([fieldFragment(c.plan)]));
    }
    const codes = [...byShape.values()];
    expect(new Set(codes).size).toBe(codes.length);
  });

  test("the fold is inlined: one min/max call per extra operand, no dispatch", async () => {
    const cases = await csgCases();
    let total = 0;
    for (const c of cases) {
      const code = tgpu.resolve([fieldFragment(c.plan)]);
      // Each combine step is its own straight-line `return min(...)` / `return
      // max(...)` — the operand count is baked in, so nothing loops or branches.
      const folds = code.match(/return (min|max)\(/g)?.length ?? 0;
      expect(folds).toBe(countFolds(c.plan.root));
      total += folds;
      // No op dispatch anywhere: the operators are gone from the shader text.
      expect(code).not.toContain("switch");
      expect(code).not.toContain("op ==");
    }
    expect(total).toBeGreaterThan(20);
  });
});
