import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import arcade from "../../../../apps/demo/src/scenes/arcade.ts";
import fillet from "../../../../apps/demo/src/scenes/fillet.ts";
import islands from "../../../../apps/demo/src/scenes/islands.ts";
import mountingPlateGrid from "../../../../apps/demo/src/scenes/mounting-plate-grid.ts";
import mountingPlate from "../../../../apps/demo/src/scenes/mounting-plate.ts";
import pie from "../../../../apps/demo/src/scenes/pie.ts";
import plateFigure from "../../../../apps/demo/src/scenes/plate-figure.ts";
import roundOffsetScene from "../../../../apps/demo/src/scenes/round-offset.ts";
import sharedLoop from "../../../../apps/demo/src/scenes/shared-loop.ts";
import shelf from "../../../../apps/demo/src/scenes/shelf.ts";
import stockCuttersFigure from "../../../../apps/demo/src/scenes/stock-cutters-figure.ts";
import stockCutters from "../../../../apps/demo/src/scenes/stock-cutters.ts";
import truss from "../../../../apps/demo/src/scenes/truss.ts";
import { hitsNear } from "../euclid2/pick";
import { figureToSvg } from "../figure/export";
import { csgPaint, fillPaint } from "../geom/csg-draw";
import { csgContains, isCsg2, isPick, offsetOfCsg } from "../geom/csg2";
import { evaluateRegions } from "../geom/evaluate-regions";
import { compileOffsetBoundary } from "../geom/offset";
import { isCircleWalk, isFiniteRegion, regionContains, walkEdges } from "../geom/region";
import { analyze, type Annotation } from "../source/analyze";
import { mergeAnnotationBundle } from "../source/catalog";
import { evaluate } from "./evaluate";
import { paintsFromTrace } from "./paint";
import type { Scene } from "./scene";

const demoSrc = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../apps/demo/src",
);

function run(mod: Scene, files: string[], draft?: Map<string, number[]>) {
  const bundle: Record<string, Record<string, Annotation>> = {};
  for (const rel of files) {
    const src = readFileSync(path.join(demoSrc, rel.replace(/^apps\/demo\/src\//, "")), "utf8");
    bundle[rel] = Object.fromEntries(analyze(src, rel));
  }
  return evaluate(mod, { annotations: mergeAnnotationBundle(bundle), draft });
}

describe("migrated demo scenes", () => {
  test("shelf traces cellar via -shelf.distance and a dist() beam", () => {
    const { trace } = run(shelf, ["apps/demo/src/scenes/shelf.ts"]);
    const kinds = trace.map((n) => n.kind);
    expect(kinds.filter((k) => k === "parallelLine")).toHaveLength(2);
    expect(trace.some((n) => n.bind === "cellar" && n.value.kind === "parallelLine")).toBe(true);
    const cellar = trace.find((n) => n.bind === "cellar");
    const shelfN = trace.find((n) => n.bind === "shelf");
    const cellarShelfDistance =
      cellar?.value.kind === "parallelLine" && shelfN?.value.kind === "parallelLine"
        ? cellar.value.distance + shelfN.value.distance
        : 0;
    expect(cellarShelfDistance).toBeCloseTo(0);
    expect(trace.some((n) => n.bind === "lamp" && n.value.kind === "gliderLine")).toBe(true);
    expect(trace.some((n) => n.bind === "beam" && n.kind === "circle")).toBe(true);
    expect(trace.some((n) => n.bind === "Q")).toBe(true);
  });

  test("shared-loop stamps five rings on one id", () => {
    const { trace } = run(sharedLoop, ["apps/demo/src/scenes/shared-loop.ts"]);
    const rings = trace.filter((n) => n.id === "o_ring");
    expect(rings).toHaveLength(5);
    expect(rings.every((n) => n.editable && n.value.kind === "circle")).toBe(true);
  });

  test("truss places gliders on the span", () => {
    const { trace } = run(truss, ["apps/demo/src/scenes/truss.ts"]);
    expect(trace.filter((n) => n.value.kind === "gliderSegment")).toHaveLength(3);
    expect(trace.filter((n) => n.kind === "circle")).toHaveLength(3);
  });

  test("mounting plate traces constructors from the layout helper", () => {
    const { trace } = run(mountingPlate, [
      "apps/demo/src/scenes/mounting-plate.ts",
      "apps/demo/src/layout/mounting-plate.ts",
    ]);
    const insets = trace.filter((n) => n.kind === "parallelLine");
    expect(insets).toHaveLength(4);
    const d0 = insets[0]?.value.kind === "parallelLine" ? insets[0].value.distance : null;
    expect(insets.every((n) => n.value.kind === "parallelLine" && n.value.distance === d0)).toBe(
      true,
    );
    expect(trace.filter((n) => n.kind === "circle")).toHaveLength(4);
    expect(trace.filter((n) => n.kind === "region")).toHaveLength(1);
    expect(trace.every((n) => n.module === "apps/demo/src/layout/mounting-plate.ts")).toBe(true);
    expect(trace.some((n) => n.bind === "drill" && n.editable)).toBe(true);
    const face = trace.find((n) => n.bind === "face");
    expect(face?.kind).toBe("region");
    if (!face || face.value.kind !== "region") throw new Error("missing face");
    expect(isFiniteRegion(face.value)).toBe(true);
    expect(face.value.holes).toHaveLength(4);
    expect(face.value.holes.every(isCircleWalk)).toBe(true);
    expect(regionContains(face.value, { x: 2, y: 1.6 })).toBe(true);
    expect(regionContains(face.value, { x: 0.62, y: 0.74 })).toBe(false);
  });

  test("plate grid evaluates six helper invocations from one looped call site", () => {
    const { trace } = run(mountingPlateGrid, [
      "apps/demo/src/scenes/mounting-plate-grid.ts",
      "apps/demo/src/layout/mounting-plate.ts",
    ]);
    expect(trace.filter((n) => n.id === "o_origin")).toHaveLength(6);
    expect(trace.filter((n) => n.id === "o_drill")).toHaveLength(6);
    expect(trace.filter((n) => n.id === "o_face")).toHaveLength(6);
    expect(trace.filter((n) => n.kind === "circle")).toHaveLength(24);
    expect(trace.filter((n) => n.kind === "region")).toHaveLength(6);
    const xs = trace
      .filter((n) => n.id === "o_origin" && n.value.kind === "point")
      .map((n) => (n.value.kind === "point" ? n.value.x : 0));
    expect(new Set(xs.map((x) => x.toFixed(2))).size).toBe(3);
  });

  test("round-offset playground traces numeric leftovers and holed plates", () => {
    const { trace } = run(roundOffsetScene, ["apps/demo/src/scenes/round-offset.ts"]);
    expect(trace.filter((n) => n.kind === "csg2")).toHaveLength(11);
    expect(trace.filter((n) => n.kind === "region")).toHaveLength(11);
    expect(trace.filter((n) => n.kind === "slider")).toHaveLength(1);

    const painted = [];
    for (const n of trace) {
      if (!isCsg2(n.value)) continue;
      const first = fillPaint(n.value);
      painted.push(first);
      expect(fillPaint(n.value)).toBe(first);
    }
    expect(painted).toHaveLength(11);

    const sqInset = trace.find((n) => n.bind === "sqInset");
    expect(sqInset?.kind).toBe("csg2");
    expect(sqInset?.editable).toBe(true);
    const sqStock = sqInset && isCsg2(sqInset.value) ? offsetOfCsg(sqInset.value) : null;
    expect(sqStock?.kind).toBe("offset");
    expect(sqStock?.kind === "offset" ? sqStock.d : 0).toBeCloseTo(-0.22);

    const shared = trace.find((n) => n.bind === "shared");
    expect(shared?.kind).toBe("csg2");
    expect(shared?.editable).toBe(false);

    const frameIn = trace.find((n) => n.bind === "frameIn");
    expect(frameIn?.value.kind === "region" ? frameIn.value.holes : []).toHaveLength(1);
    const twoHoles = trace.find((n) => n.bind === "twoHoles");
    expect(twoHoles?.value.kind === "region" ? twoHoles.value.holes : []).toHaveLength(2);
    const twoInset = trace.find((n) => n.bind === "twoInset");
    if (!twoInset || !isCsg2(twoInset.value) || !offsetOfCsg(twoInset.value)) {
      throw new Error("missing twoInset");
    }
    const twoShallow = compileOffsetBoundary(offsetOfCsg(twoInset.value)!);
    expect(twoShallow).toHaveLength(1);
    expect(twoShallow[0]?.holes).toHaveLength(2);
    expect(csgContains(twoInset.value, { x: 7.45, y: 4.8 })).toBe(true);
    expect(csgContains(twoInset.value, { x: 8.4, y: 4.8 })).toBe(false);
    const circHole = trace.find((n) => n.bind === "circHole");
    expect(
      circHole?.value.kind === "region" ? walkEdges(circHole.value.outer).length : 0,
    ).toBeGreaterThan(0);
    expect(circHole?.value.kind === "region" ? circHole.value.holes : []).toHaveLength(1);
    expect(circHole?.value.kind === "region" ? isCircleWalk(circHole.value.holes[0]!) : false).toBe(
      true,
    );

    const holeInset = trace.find((n) => n.bind === "holeInset");
    expect(holeInset?.editable).toBe(true);
    if (!holeInset || !isCsg2(holeInset.value)) throw new Error("missing holeInset");
    expect(csgContains(holeInset.value, { x: 0.3, y: 3.8 })).toBe(true);
    expect(csgContains(holeInset.value, { x: 1.4, y: 4.8 })).toBe(false);

    const circInset = trace.find((n) => n.bind === "circInset");
    if (!circInset || !isCsg2(circInset.value) || !offsetOfCsg(circInset.value)) {
      throw new Error("missing circInset");
    }
    expect(csgContains(circInset.value, { x: 12.4, y: 3.7 })).toBe(true);
    expect(csgContains(circInset.value, { x: 13.7, y: 4.8 })).toBe(false);
    const circIslands = compileOffsetBoundary(offsetOfCsg(circInset.value)!);
    expect(circIslands).toHaveLength(1);
    expect(circIslands[0]?.holes).toHaveLength(1);
    const circHoleWalk = circIslands[0]!.holes[0]!;
    if (!isCircleWalk(circHoleWalk)) throw new Error("circInset hole is not a circle");
    expect(circHoleWalk.radius).toBeCloseTo(0.64);

    const boneInset = trace.find((n) => n.bind === "boneInset");
    if (!boneInset || !isCsg2(boneInset.value)) throw new Error("missing boneInset");
    expect(compileOffsetBoundary(offsetOfCsg(boneInset.value)!)).toHaveLength(1);

    const drafted = run(
      roundOffsetScene,
      ["apps/demo/src/scenes/round-offset.ts"],
      new Map([
        ["o_ro_sqi", [-0.4]],
        ["o_ro_bone", [-0.22]],
        ["o_ro_tw", [-0.2]],
        ["o_ro_ch", [-0.42]],
      ]),
    );
    const pulled = drafted.trace.find((n) => n.id === "o_ro_sqi");
    const pulledStock = pulled && isCsg2(pulled.value) ? offsetOfCsg(pulled.value) : null;
    expect(pulledStock?.kind === "offset" ? pulledStock.d : 0).toBeCloseTo(-0.4);
    const splitBone = drafted.trace.find((n) => n.id === "o_ro_bone");
    if (!splitBone || !isCsg2(splitBone.value)) throw new Error("missing split bone");
    expect(compileOffsetBoundary(offsetOfCsg(splitBone.value)!)).toHaveLength(2);
    const pinched = drafted.trace.find((n) => n.id === "o_ro_tw");
    if (!pinched || !isCsg2(pinched.value) || !offsetOfCsg(pinched.value)) {
      throw new Error("missing twoInset");
    }
    expect(csgContains(pinched.value, { x: 7.45, y: 4.8 })).toBe(true);
    expect(csgContains(pinched.value, { x: 8.4, y: 4.8 })).toBe(false);
    expect(csgContains(pinched.value, { x: 10.3, y: 4.8 })).toBe(false);
    expect(csgContains(pinched.value, { x: 9.35, y: 4.8 })).toBe(false);
    const pinchedIslands = compileOffsetBoundary(offsetOfCsg(pinched.value)!);
    expect(pinchedIslands).toHaveLength(1);
    expect(pinchedIslands[0]?.holes.length).toBeGreaterThan(0);
    const punched = drafted.trace.find((n) => n.id === "o_ro_ch");
    if (!punched || !isCsg2(punched.value) || !offsetOfCsg(punched.value)) {
      throw new Error("missing circInset");
    }
    const lenses = compileOffsetBoundary(offsetOfCsg(punched.value)!);
    expect(lenses).toHaveLength(2);
    expect(lenses.some((q) => regionContains(q, { x: 12.69, y: 4.8 }))).toBe(true);
    expect(lenses.some((q) => regionContains(q, { x: 14.71, y: 4.8 }))).toBe(true);
    expect(lenses.some((q) => regionContains(q, { x: 13.7, y: 4.8 }))).toBe(false);
  });

  test("pie traces three roundOffset slices from one gap slider", () => {
    const { trace } = run(pie, ["apps/demo/src/scenes/pie.ts"]);
    expect(trace.filter((n) => n.kind === "region")).toHaveLength(0);
    expect(trace.filter((n) => n.kind === "csg2")).toHaveLength(3);
    expect(trace.filter((n) => n.kind === "segment")).toHaveLength(3);
    expect(trace.filter((n) => n.value.kind === "gliderCircle")).toHaveLength(3);
    expect(trace.some((n) => n.bind === "gap" && n.kind === "slider")).toBe(true);
    const one = trace.find((n) => n.bind === "one");
    expect(one?.kind).toBe("csg2");
    expect(one?.editable).toBe(false);
    const stock = one && isCsg2(one.value) ? offsetOfCsg(one.value) : null;
    expect(stock?.kind).toBe("offset");
    expect(stock?.kind === "offset" ? stock.d : 0).toBeCloseTo(-0.12);
  });

  test("plate figure paints returned fields from the same helper", () => {
    const { trace } = run(plateFigure, [
      "apps/demo/src/scenes/plate-figure.ts",
      "apps/demo/src/layout/mounting-plate.ts",
    ]);
    expect(trace.filter((n) => n.kind === "paint")).toHaveLength(5);
    expect(trace.filter((n) => n.kind === "style")).toHaveLength(0);
    expect(trace.some((n) => n.bind === "drill" && n.kind === "circle")).toBe(true);
    expect(trace.some((n) => n.bind === "face" && n.kind === "region")).toBe(true);
    const paints = paintsFromTrace(trace);
    expect(paints.has("o_face:0")).toBe(true);
    expect(paints.has("o_drill:0")).toBe(true);
    expect(paints.has("o_origin:0")).toBe(true);
    expect(paints.has("o_in:0")).toBe(true);
    expect(paints.has("o_bot:0")).toBe(false);

    const out = figureToSvg({
      trace,
      frame: plateFigure.frame,
      camera: plateFigure.camera,
      paper: plateFigure.paper,
      title: plateFigure.title,
    });
    expect(out.svg).toMatch(/\sA /);
    expect(out.svg).toContain('fill-rule="evenodd"');
  });

  test("arcade traces pac-man as disk minus wedge and a unioned ghost", () => {
    const { trace } = run(arcade, ["apps/demo/src/scenes/arcade.ts"]);
    expect(trace.filter((n) => n.kind === "csg2")).toHaveLength(2);
    const pac = trace.find((n) => n.bind === "pac");
    const ghost = trace.find((n) => n.bind === "ghost");
    expect(pac?.kind).toBe("csg2");
    expect(ghost?.kind).toBe("csg2");
    if (!pac || !isCsg2(pac.value) || !ghost || !isCsg2(ghost.value)) {
      throw new Error("missing arcade faces");
    }
    expect(csgContains(pac.value, { x: 0.5, y: 1.6 })).toBe(true);
    expect(csgContains(pac.value, { x: 2.4, y: 1.6 })).toBe(false);
    expect(csgContains(ghost.value, { x: 6.55, y: 0.9 })).toBe(true);
    expect(csgContains(ghost.value, { x: 6.17, y: 1.97 })).toBe(false);

    const drafted = run(
      arcade,
      ["apps/demo/src/scenes/arcade.ts"],
      new Map([["o_ar_el", [8.5, 3.2]]]),
    );
    const ghostOff = drafted.trace.find((n) => n.id === "o_ar_ghost");
    if (!ghostOff || !isCsg2(ghostOff.value)) throw new Error("missing ghost");
    expect(csgContains(ghostOff.value, { x: 6.17, y: 1.97 })).toBe(true);
    expect(csgContains(ghostOff.value, { x: 8.5, y: 3.2 })).toBe(false);
  });

  test("fillet scene traces the challenge cases from one radius slider", () => {
    const { trace } = run(fillet, ["apps/demo/src/scenes/fillet.ts"]);
    expect(trace.filter((n) => n.kind === "region")).toHaveLength(8);
    expect(trace.filter((n) => n.kind === "csg2")).toHaveLength(1);
    expect(trace.some((n) => n.bind === "r" && n.kind === "slider")).toBe(true);
    const flat = trace.find((n) => n.bind === "flat");
    expect(flat?.kind).toBe("region");
    expect(flat?.value.kind === "region" ? walkEdges(flat.value.outer) : []).toHaveLength(
      flat?.value.kind === "region" ? 3 : 0,
    );
    expect(
      flat?.value.kind === "region"
        ? walkEdges(flat.value.outer).filter((e) => e.carrier.kind === "circle")
        : [],
    ).toHaveLength(flat?.value.kind === "region" ? 1 : 0);
    const mix = trace.find((n) => n.bind === "mix");
    expect(mix?.kind).toBe("region");
    expect(mix?.value.kind === "region" ? walkEdges(mix.value.outer) : []).toHaveLength(
      mix?.value.kind === "region" ? 6 : 0,
    );
    expect(
      mix?.value.kind === "region"
        ? walkEdges(mix.value.outer).filter((e) => e.carrier.kind === "circle")
        : [],
    ).toHaveLength(mix?.value.kind === "region" ? 2 : 0);
    const ell = trace.find((n) => n.bind === "ell");
    expect(ell?.value.kind === "region" ? walkEdges(ell.value.outer) : []).toHaveLength(
      ell?.value.kind === "region" ? 7 : 0,
    );
    expect(
      ell?.value.kind === "region"
        ? walkEdges(ell.value.outer).filter((e) => e.carrier.kind === "circle")
        : [],
    ).toHaveLength(ell?.value.kind === "region" ? 1 : 0);
    const rim = trace.find((n) => n.bind === "rim");
    expect(rim?.value.kind === "region" ? walkEdges(rim.value.outer) : []).toHaveLength(
      rim?.value.kind === "region" ? 5 : 0,
    );
    const tip = trace.find((n) => n.bind === "tip");
    expect(tip?.value.kind === "region" ? walkEdges(tip.value.outer) : []).toHaveLength(
      tip?.value.kind === "region" ? 4 : 0,
    );
    const adj = trace.find((n) => n.bind === "adj");
    expect(adj?.value.kind === "region" ? walkEdges(adj.value.outer) : []).toHaveLength(
      adj?.value.kind === "region" ? 6 : 0,
    );
    const inset = trace.find((n) => n.bind === "inset");
    expect(inset?.kind).toBe("csg2");
    expect(inset?.editable).toBe(true);
    const insetStock = inset && isCsg2(inset.value) ? offsetOfCsg(inset.value) : null;
    expect(insetStock?.kind).toBe("offset");
    expect(insetStock?.kind === "offset" ? insetStock.d : 0).toBeCloseTo(-0.12);
  });

  test("stock-cutters traces one face formula plus hold/left/right", () => {
    const files = [
      "apps/demo/src/scenes/stock-cutters.ts",
      "apps/demo/src/layout/stock-cutters.ts",
    ];
    const { trace } = run(stockCutters, files);
    expect(trace.filter((n) => n.kind === "csg2")).toHaveLength(3);
    expect(trace.filter((n) => n.kind === "pick")).toHaveLength(1);
    expect(trace.some((n) => n.bind === "face" && n.kind === "csg2")).toBe(true);
    expect(trace.some((n) => n.bind === "hold" && n.kind === "pick")).toBe(true);
    expect(trace.some((n) => n.bind === "left" && n.kind === "csg2")).toBe(true);
    expect(trace.some((n) => n.bind === "right" && n.kind === "csg2")).toBe(true);
    expect(trace.some((n) => n.bind === "stock" && n.kind === "region")).toBe(true);
    expect(trace.some((n) => n.bind === "slot" && n.kind === "region")).toBe(true);

    const face = trace.find((n) => n.id === "o_sc_face");
    expect(face?.value.kind).toBe("csg2");
    if (!face || !isCsg2(face.value)) throw new Error("missing face");
    expect(csgContains(face.value, { x: 1.05, y: 1.6 })).toBe(true);
    expect(csgContains(face.value, { x: 3.55, y: 1.6 })).toBe(false);

    const camera = { x: 2.25, y: 1.6, scale: 72 };
    const size = { w: 800, h: 600 };
    const hits = hitsNear(trace, { x: 1.2, y: 1.6 }, camera, size);
    expect(hits.find((n) => n.kind === "csg2")?.id).toBe("o_sc_face");
  });

  test("stock-cutters: drill off the plate drops that hole, not an XOR cap", () => {
    const files = [
      "apps/demo/src/scenes/stock-cutters.ts",
      "apps/demo/src/layout/stock-cutters.ts",
    ];
    const { trace } = run(stockCutters, files, new Map([["o_sc_c0", [-1, -1]]]));
    const face = trace.find((n) => n.id === "o_sc_face");
    expect(face?.kind).toBe("csg2");
    if (!face || !isCsg2(face.value)) throw new Error("missing face");
    expect(csgContains(face.value, { x: 0.57, y: 0.62 })).toBe(true);
    expect(csgContains(face.value, { x: -1, y: -1 })).toBe(false);
  });

  test("stock-cutters: a slot that severs stays one region; contains follows the probe", () => {
    const files = [
      "apps/demo/src/scenes/stock-cutters.ts",
      "apps/demo/src/layout/stock-cutters.ts",
    ];
    const { trace } = run(
      stockCutters,
      files,
      new Map([
        ["o_sc_slotX", [2.25]],
        ["o_sc_slotL", [5]],
        ["o_sc_probe", [1.05, 2.4]],
      ]),
    );
    const face = trace.find((n) => n.id === "o_sc_face");
    const hold = trace.find((n) => n.id === "o_sc_hold");
    expect(face?.kind).toBe("csg2");
    expect(hold?.kind).toBe("pick");
    if (!face || !isCsg2(face.value) || !hold || !isPick(hold.value))
      throw new Error("missing regions");
    expect(csgContains(face.value, { x: 1.05, y: 2.4 })).toBe(true);
    expect(csgContains(face.value, { x: 1.05, y: 0.5 })).toBe(true);
    expect(csgContains(face.value, { x: 2.25, y: 1.6 })).toBe(false);
    expect(
      csgContains(face.value, { x: 1.05, y: 2.4 }) && csgContains(face.value, { x: 1.05, y: 0.5 }),
    ).toBe(true);
    expect(csgContains(hold.value, { x: 1.05, y: 2.4 })).toBe(true);
    expect(csgContains(hold.value, { x: 1.05, y: 0.5 })).toBe(false);

    const empty = run(stockCutters, files, new Map([["o_sc_probe", [3.55, 1.6]]]));
    const holdEmpty = empty.trace.find((n) => n.id === "o_sc_hold");
    expect(empty.trace.some((n) => n.id === "o_sc_probe")).toBe(true);
    if (!holdEmpty || !isPick(holdEmpty.value)) throw new Error("missing hold");
    expect(csgContains(holdEmpty.value, { x: 3.55, y: 1.6 })).toBe(false);
  });

  test("stock-cutters figure paints the face formula, not an island", () => {
    const { trace } = run(stockCuttersFigure, [
      "apps/demo/src/scenes/stock-cutters-figure.ts",
      "apps/demo/src/layout/stock-cutters.ts",
    ]);
    expect(trace.filter((n) => n.kind === "paint")).toHaveLength(3);
    const paints = paintsFromTrace(trace);
    expect(paints.has("o_sc_face:0")).toBe(true);
    expect(paints.has("o_sc_probe:0")).toBe(true);
    expect(paints.has("o_sc_split:0")).toBe(true);

    const out = figureToSvg({
      trace,
      frame: stockCuttersFigure.frame,
      camera: stockCuttersFigure.camera,
      paper: stockCuttersFigure.paper,
      title: stockCuttersFigure.title,
    });
    expect(out.svg).toContain("<mask");
    expect(out.svg).toContain('maskUnits="userSpaceOnUse"');
    expect(out.svg).toMatch(/\sA /);
    expect(out.svg).toContain("<circle");
  });

  test("islands scene fills compiled picks, not the unmarked CSG", () => {
    const { trace } = run(islands, ["apps/demo/src/scenes/islands.ts"]);
    expect(trace.filter((n) => n.kind === "pick")).toHaveLength(3);
    expect(trace.filter((n) => n.kind === "csg2")).toHaveLength(0);
    expect(trace.some((n) => n.bind === "hold" && n.kind === "pick")).toBe(true);
    expect(trace.some((n) => n.bind === "holdPair" && n.kind === "pick")).toBe(true);
    expect(trace.some((n) => n.bind === "holdFil" && n.kind === "pick")).toBe(true);

    const hold = trace.find((n) => n.id === "o_is_hold");
    const pair = trace.find((n) => n.id === "o_is_pair");
    const holdFil = trace.find((n) => n.id === "o_is_fillet");
    if (
      !hold ||
      !isPick(hold.value) ||
      !pair ||
      !isPick(pair.value) ||
      !holdFil ||
      !isPick(holdFil.value)
    ) {
      throw new Error("missing picks");
    }
    expect(evaluateRegions(hold.value)).toHaveLength(1);
    expect(csgContains(hold.value, { x: 5.15, y: 2.35 })).toBe(true);
    expect(csgContains(hold.value, { x: 5.15, y: 0.7 })).toBe(false);
    const holdPaint = csgPaint(hold.value);
    expect(holdPaint.empty).toBe(false);
    expect(holdPaint.stock.kind).toBe("path");
    if (holdPaint.stock.kind !== "path") throw new Error("expected path");
    expect(holdPaint.stock.d).toMatch(/^M /);
    expect(holdPaint.stock.d).not.toMatch(/ H /);

    expect(csgContains(pair.value, { x: 1.05, y: 1.55 })).toBe(true);
    expect(csgContains(pair.value, { x: 2.9, y: 1.55 })).toBe(false);
    const pairPaint = csgPaint(pair.value);
    expect(pairPaint.empty).toBe(false);
    if (pairPaint.stock.kind !== "path") throw new Error("expected path");
    expect(pairPaint.stock.d).toMatch(/A /);

    const filPaint = csgPaint(holdFil.value);
    expect(filPaint.empty).toBe(false);
    if (filPaint.stock.kind !== "path") throw new Error("expected path");
    expect(filPaint.stock.d).toMatch(/A /);
    expect(csgContains(holdFil.value, { x: 10.2, y: 1.5 })).toBe(true);
    expect(csgContains(holdFil.value, { x: 11, y: 1.5 })).toBe(false);
  });

  test("islands: probe in the slot empties the pick; the other island stays off", () => {
    const files = ["apps/demo/src/scenes/islands.ts"];
    const empty = run(islands, files, new Map([["o_is_probe", [6.5, 1.55]]]));
    const holdEmpty = empty.trace.find((n) => n.id === "o_is_hold");
    if (!holdEmpty || !isPick(holdEmpty.value)) throw new Error("missing hold");
    expect(evaluateRegions(holdEmpty.value)).toHaveLength(0);
    expect(csgContains(holdEmpty.value, { x: 5.15, y: 2.35 })).toBe(false);

    const swapped = run(islands, files, new Map([["o_is_probe", [5.15, 0.7]]]));
    const holdBot = swapped.trace.find((n) => n.id === "o_is_hold");
    if (!holdBot || !isPick(holdBot.value)) throw new Error("missing hold");
    expect(csgContains(holdBot.value, { x: 5.15, y: 0.7 })).toBe(true);
    expect(csgContains(holdBot.value, { x: 5.15, y: 2.35 })).toBe(false);
  });

  test("islands: wide slot at SlotX knife-edge still fills the pick", () => {
    const files = ["apps/demo/src/scenes/islands.ts"];
    const top = { x: 5.15, y: 2.35 };
    const bot = { x: 5.15, y: 0.7 };
    for (const slotX of [6.24, 6.36, 6.64, 6.76]) {
      const { trace } = run(
        islands,
        files,
        new Map([
          ["o_is_slotX", [slotX]],
          ["o_is_slotW", [0.94]],
        ]),
      );
      const hold = trace.find((n) => n.id === "o_is_hold");
      if (!hold || !isPick(hold.value)) throw new Error("missing hold");
      const kept = evaluateRegions(hold.value);
      expect(kept).toHaveLength(1);
      expect(csgContains(hold.value, top)).toBe(true);
      const through = slotX >= 6.35 && slotX <= 6.65;
      expect(csgContains(hold.value, bot)).toBe(!through);
      const paint = csgPaint(hold.value);
      expect(paint.empty).toBe(false);
    }
  });
});
