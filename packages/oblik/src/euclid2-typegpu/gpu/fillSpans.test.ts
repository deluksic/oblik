import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import type { CsgOperand, Loop, LoopEdge, Region, Vec2 } from "#geom";
import { isFillGeom } from "#geom/csg2";

import { evaluate } from "../../eval/evaluate";
import type { Scene } from "../../eval/scene";
import { analyze, type Annotation } from "../../source/analyze";
import { mergeAnnotationBundle } from "../../source/catalog";
import { buildFieldInstance, fieldPlan } from "./field/plan";
import {
  blockWindows,
  emptySpans,
  islandGeomOf,
  islandSpans,
  pushLoopSpan,
  type SpanSet,
  type SpanWindow,
} from "./fillSpans";
import { MAX_FIELD_ARCS, MAX_FIELD_SEGS, MAX_FILL_ARCS, MAX_FILL_SEGS } from "./schemas";

const demoSrc = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../apps/demo/src",
);

/** Square loop of segment edges, corners given CCW. */
function squareLoop(half: number): LoopEdge[] {
  const corners: Vec2[] = [
    { x: -half, y: -half },
    { x: half, y: -half },
    { x: half, y: half },
    { x: -half, y: half },
  ];
  return corners.map((a, i) => {
    const b = corners[(i + 1) % corners.length]!;
    return { a, b, carrier: { kind: "segment" as const, a, b } };
  });
}

const circleLoop = (radius: number): Loop => ({
  kind: "circle",
  center: { x: 0, y: 0 },
  radius,
});

/** Every fill node of every demo scene, split into span-path and field-path. */
async function demoFills(): Promise<{
  spanSegs: number;
  spanArcs: number;
  fieldSegs: number;
  fieldArcs: number;
  nodes: number;
  rows: string[];
}> {
  const names = readdirSync(path.join(demoSrc, "scenes"))
    .filter((f) => f.endsWith(".ts"))
    .map((f) => f.replace(/\.ts$/, ""));
  const totals = { spanSegs: 0, spanArcs: 0, fieldSegs: 0, fieldArcs: 0, nodes: 0 };
  const rows: string[] = [];
  for (const name of names) {
    const rel = `apps/demo/src/scenes/${name}.ts`;
    const src = readFileSync(path.join(demoSrc, `scenes/${name}.ts`), "utf8");
    const bundle: Record<string, Record<string, Annotation>> = {
      [rel]: Object.fromEntries(analyze(src, rel)),
    };
    const mod = (await import(`../../../../../apps/demo/src/scenes/${name}.ts`)) as {
      default: Scene;
    };
    const trace = evaluate(mod.default, { annotations: mergeAnnotationBundle(bundle) }).trace;
    for (const n of trace) {
      if (!isFillGeom(n.value)) continue;
      totals.nodes++;
      const plan = fieldPlan(n.value as CsgOperand);
      if (plan) {
        const inst = buildFieldInstance(plan);
        totals.fieldSegs += inst.spans.segs.length;
        totals.fieldArcs += inst.spans.arcs.length;
        rows.push(
          `${name}.${n.bind ?? n.id} field segs=${inst.spans.segs.length} arcs=${inst.spans.arcs.length}`,
        );
        continue;
      }
      let segs = 0;
      let arcs = 0;
      // The span path allocates exactly what `islandGeomOf` hands the adapter.
      for (const block of islandGeomOf(n.value as Region).spans) {
        segs += block.segs.length;
        arcs += block.arcs.length;
      }
      totals.spanSegs += segs;
      totals.spanArcs += arcs;
      rows.push(`${name}.${n.bind ?? n.id} spans segs=${segs} arcs=${arcs}`);
    }
  }
  return { ...totals, rows };
}

describe("span records", () => {
  test("a full-circle carrier is one arc record, a chain is segments", () => {
    const spans = islandSpans({ kind: "region", outer: circleLoop(2), holes: [squareLoop(1)] });
    expect(spans.arcs).toHaveLength(1);
    expect(spans.segs).toHaveLength(4);
    const arc = spans.arcs[0]!;
    expect(arc.radius).toBe(2);
    expect(arc.span).toBeCloseTo(Math.PI * 2, 12);
    // The hole is a clockwise loop, so its segments run the other way.
    expect(spans.segs[0]!.a).toEqual({ x: 1, y: -1 });
    expect(spans.segs[0]!.b).toEqual({ x: -1, y: -1 });
  });

  test("reversing a loop edge flips the record, not the carrier", () => {
    const out: SpanSet = emptySpans();
    const carrier = { kind: "circle" as const, center: { x: 1, y: 2 }, radius: 3 };
    const edge: LoopEdge = { a: { x: 4, y: 2 }, b: { x: 1, y: 5 }, carrier, k: 1 };
    pushLoopSpan(out, edge, false);
    pushLoopSpan(out, edge, true);
    expect(out.arcs).toHaveLength(2);
    const [forward, backward] = out.arcs as [(typeof out.arcs)[0], (typeof out.arcs)[0]];
    expect(forward!.span).toBeCloseTo(-backward!.span, 12);
    expect(backward!.a).toEqual(forward!.b);
    expect(backward!.center).toEqual(forward!.center);
    expect(backward!.radius).toBe(forward!.radius);
    // Segment: only the endpoints swap, and no arc record is created.
    pushLoopSpan(out, { a: edge.a, b: edge.b, carrier: { kind: "segment", a: edge.a, b: edge.b } });
    expect(out.segs).toEqual([{ a: edge.a, b: edge.b }]);
  });

  test("windows address each kind's concatenation", () => {
    const blocks: SpanSet[] = [
      islandSpans({ kind: "region", outer: squareLoop(1), holes: [] }),
      islandSpans({ kind: "region", outer: circleLoop(2), holes: [squareLoop(0.5)] }),
      islandSpans({ kind: "region", outer: circleLoop(1), holes: [] }),
    ];
    const windows = blockWindows(blocks);
    const segs = blocks.flatMap((b) => b.segs);
    const arcs = blocks.flatMap((b) => b.arcs);
    const slice = (w: SpanWindow) => ({
      segs: segs.slice(w.segOffset, w.segOffset + w.segCount),
      arcs: arcs.slice(w.arcOffset, w.arcOffset + w.arcCount),
    });
    // Each window returns exactly the block it was cut for, from either array.
    windows.forEach((w, i) => expect(slice(w)).toEqual(blocks[i]));
    expect(segs).toHaveLength(8);
    expect(arcs).toHaveLength(2);
    expect(windows.map((w) => w.arcOffset)).toEqual([0, 0, 1]);
    expect(windows.map((w) => w.segOffset)).toEqual([0, 4, 8]);
  });

  test("the demo's span load fits both pools, per node and in total", async () => {
    const t = await demoFills();
    // eslint-disable-next-line no-console
    console.log(
      `${t.nodes} demo fills: span path ${t.spanSegs} segs / ${t.spanArcs} arcs, ` +
        `field path ${t.fieldSegs} segs / ${t.fieldArcs} arcs\n${t.rows.join("\n")}`,
    );
    // Pools are shared across nodes, so the totals are what the caps must hold.
    expect(t.spanSegs).toBeLessThanOrEqual(MAX_FILL_SEGS);
    expect(t.spanArcs).toBeLessThanOrEqual(MAX_FILL_ARCS);
    expect(t.fieldSegs).toBeLessThanOrEqual(MAX_FIELD_SEGS);
    expect(t.fieldArcs).toBeLessThanOrEqual(MAX_FIELD_ARCS);
    // Both record kinds are actually exercised by the demo set.
    expect(t.spanSegs).toBeGreaterThan(0);
    expect(t.fieldArcs).toBeGreaterThan(0);
  });
});
