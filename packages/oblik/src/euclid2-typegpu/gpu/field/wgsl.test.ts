import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { tgpu } from "typegpu";
import { describe, expect, test } from "vitest";

import type { CsgOperand, Vec2 } from "#geom";
import { isFillGeom } from "#geom/csg2";

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
      const plan = fieldPlan(n.value as CsgOperand);
      if (plan)
        cases.push({ scene: name, bind: n.bind ?? n.id, value: n.value as CsgOperand, plan });
    }
  }
  return cases;
}

/** Rewrite every number a field leaf reads, leaving the tree's shape alone. */
function nudgeLeafData(op: CsgOperand, k: number): void {
  const v = op as { kind: string } & Record<string, unknown>;
  if (v.kind === "circle") v.radius = (v.radius as number) * k;
  if (v.kind === "offset") v.d = (v.d as number) + k;
  if (v.kind === "region") {
    const edges = (v.outer as { a: Vec2 }[]) ?? [];
    for (const e of edges) e.a = { x: e.a.x + k, y: e.a.y - k };
  }
  const of = v.of as CsgOperand[] | CsgOperand | undefined;
  if (Array.isArray(of)) for (const child of of) nudgeLeafData(child, k);
  else if (of && typeof of === "object") nudgeLeafData(of, k);
}

function countLeaves(node: FieldNodePlan): number {
  if (node.kind === "leaf") return 1;
  if (node.kind === "offset") return countLeaves(node.of) + 1;
  return node.of.reduce((sum, child) => sum + countLeaves(child), 0);
}

/** One combine call per operand beyond the first, folded at codegen time. */
function countFolds(node: FieldNodePlan): number {
  if (node.kind === "leaf") return 0;
  if (node.kind === "offset") return countFolds(node.of);
  return node.of.length - 1 + node.of.reduce((sum, child) => sum + countFolds(child), 0);
}

function countSpanLeaves(plan: FieldPlan, node: FieldNodePlan = plan.root): number {
  if (node.kind === "leaf") return plan.leaves[node.leaf]!.kind === "spans" ? 1 : 0;
  if (node.kind === "offset") return countSpanLeaves(plan, node.of);
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
      let code = seen.get(c.plan.shape);
      if (code === undefined) {
        code = tgpu.resolve([fieldFragment(c.plan)]);
        seen.set(c.plan.shape, code);
      }
      // A fragment entry plus its helpers, with no unresolved placeholders.
      expect(code).toContain("@fragment fn");
      expect(code).not.toContain("undefined");
      // Every leaf is read at a literal offset from the node's leaf window.
      expect(occurrences(code, "fieldLeaves[(base + ")).toBe(countLeaves(c.plan.root));
      // The only runtime loop is the shared span walk; the tree itself is
      // straight-line calls, which is the whole point of compiling it.
      expect(occurrences(code, "for (var")).toBe(countSpanLeaves(c.plan) > 0 ? 1 : 0);
    }
    expect(seen.size).toBeGreaterThan(5);
  });

  test("leaf data never reaches the shader", async () => {
    const cases = await csgCases();
    for (const c of cases) {
      const moved = JSON.parse(JSON.stringify(c.value)) as CsgOperand;
      nudgeLeafData(moved, 1.7);
      const replanned = fieldPlan(moved);
      expect(replanned?.shape).toBe(c.plan.shape);
      // Same shape, wildly different numbers → byte-identical WGSL. This is the
      // guarantee that a drag can never trigger a recompile.
      expect(tgpu.resolve([fieldFragment(replanned!)])).toBe(tgpu.resolve([fieldFragment(c.plan)]));
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
