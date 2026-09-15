import { describe, expect, test } from "vitest";

import type { Loop, LoopEdge, Vec2 } from "#geom";

import { buildFieldInstance, fieldPlan } from "./field/plan";
import { FILL_CORPUS } from "./fillCorpus.fixture";
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

const circleLoop = (radius: number): Loop => ({ kind: "circle", center: { x: 0, y: 0 }, radius });

/** The corpus splits into the two paths the adapter routes fills to: a plan
 * compiles to a field, and anything the plan refuses (a pick) keeps its spans. */
function corpusFills(): {
  spanSegs: number;
  spanArcs: number;
  fieldSegs: number;
  fieldArcs: number;
  nodes: number;
  rows: string[];
  worst: { name: string; segs: number; arcs: number; field: boolean }[];
} {
  const totals = { spanSegs: 0, spanArcs: 0, fieldSegs: 0, fieldArcs: 0, nodes: 0 };
  const rows: string[] = [];
  const worst: { name: string; segs: number; arcs: number; field: boolean }[] = [];
  for (const { name, value } of FILL_CORPUS) {
    totals.nodes++;
    const plan = fieldPlan(value);
    if (plan) {
      const inst = buildFieldInstance(plan);
      const segs = inst.spans.segs.length;
      const arcs = inst.spans.arcs.length;
      totals.fieldSegs += segs;
      totals.fieldArcs += arcs;
      worst.push({ name, segs, arcs, field: true });
      rows.push(`${name} field segs=${segs} arcs=${arcs}`);
      continue;
    }
    let segs = 0;
    let arcs = 0;
    // The span path allocates exactly what `islandGeomOf` hands the adapter.
    for (const block of islandGeomOf(value).spans) {
      segs += block.segs.length;
      arcs += block.arcs.length;
    }
    totals.spanSegs += segs;
    totals.spanArcs += arcs;
    worst.push({ name, segs, arcs, field: false });
    rows.push(`${name} spans segs=${segs} arcs=${arcs}`);
  }
  return { ...totals, rows, worst };
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

  test("the corpus load fits both pools, per node and in total", () => {
    const t = corpusFills();
    // eslint-disable-next-line no-console
    console.log(
      `${t.nodes} corpus fills: span path ${t.spanSegs} segs / ${t.spanArcs} arcs, ` +
        `field path ${t.fieldSegs} segs / ${t.fieldArcs} arcs\n${t.rows.join("\n")}`,
    );
    // A pool is shared across nodes, so the totals are what the caps must hold —
    // and each node's window has to fit the array on its own.
    for (const w of t.worst) {
      const segCap = w.field ? MAX_FIELD_SEGS : MAX_FILL_SEGS;
      const arcCap = w.field ? MAX_FIELD_ARCS : MAX_FILL_ARCS;
      expect(`${w.name} ${w.segs}/${segCap} ${w.arcs}/${arcCap}`).toBe(
        `${w.name} ${Math.min(w.segs, segCap)}/${segCap} ${Math.min(w.arcs, arcCap)}/${arcCap}`,
      );
    }
    expect(t.spanSegs).toBeLessThanOrEqual(MAX_FILL_SEGS);
    expect(t.spanArcs).toBeLessThanOrEqual(MAX_FILL_ARCS);
    expect(t.fieldSegs).toBeLessThanOrEqual(MAX_FIELD_SEGS);
    expect(t.fieldArcs).toBeLessThanOrEqual(MAX_FIELD_ARCS);
    // Both record kinds are actually exercised by the corpus.
    expect(t.spanSegs).toBeGreaterThan(0);
    expect(t.fieldArcs).toBeGreaterThan(0);
  });
});
