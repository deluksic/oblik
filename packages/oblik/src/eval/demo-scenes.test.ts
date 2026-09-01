import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

import { analyze, type Annotation } from "../source/analyze";
import { mergeAnnotationBundle } from "../source/catalog";
import { evaluate } from "./evaluate";
import { paintsFromTrace } from "./paint";
import fillet from "../../../../apps/demo/src/scenes/fillet.ts";
import mountingPlateGrid from "../../../../apps/demo/src/scenes/mounting-plate-grid.ts";
import mountingPlate from "../../../../apps/demo/src/scenes/mounting-plate.ts";
import pie from "../../../../apps/demo/src/scenes/pie.ts";
import sharedLoop from "../../../../apps/demo/src/scenes/shared-loop.ts";
import shelf from "../../../../apps/demo/src/scenes/shelf.ts";
import truss from "../../../../apps/demo/src/scenes/truss.ts";
import plateFigure from "../../../../apps/demo/src/scenes/plate-figure.ts";
import type { Scene } from "./scene";

const demoSrc = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../apps/demo/src");

function run(mod: Scene, files: string[]) {
  const bundle: Record<string, Record<string, Annotation>> = {};
  for (const rel of files) {
    const src = readFileSync(path.join(demoSrc, rel.replace(/^apps\/demo\/src\//, "")), "utf8");
    bundle[rel] = Object.fromEntries(analyze(src, rel));
  }
  return evaluate(mod, { annotations: mergeAnnotationBundle(bundle) });
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
    expect(insets.every((n) => n.value.kind === "parallelLine" && n.value.distance === d0)).toBe(true);
    expect(trace.filter((n) => n.kind === "circle")).toHaveLength(4);
    expect(trace.every((n) => n.module === "apps/demo/src/layout/mounting-plate.ts")).toBe(true);
    expect(trace.some((n) => n.bind === "drill" && n.editable)).toBe(true);
  });

  test("plate grid evaluates six helper invocations from one looped call site", () => {
    const { trace } = run(mountingPlateGrid, [
      "apps/demo/src/scenes/mounting-plate-grid.ts",
      "apps/demo/src/layout/mounting-plate.ts",
    ]);
    expect(trace.filter((n) => n.id === "o_origin")).toHaveLength(6);
    expect(trace.filter((n) => n.id === "o_drill")).toHaveLength(6);
    expect(trace.filter((n) => n.kind === "circle")).toHaveLength(24);
    const xs = trace
      .filter((n) => n.id === "o_origin" && n.value.kind === "point")
      .map((n) => (n.value.kind === "point" ? n.value.x : 0));
    expect(new Set(xs.map((x) => x.toFixed(2))).size).toBe(3);
  });

  test("pie traces three roundOffset slices from one gap slider", () => {
    const { trace } = run(pie, ["apps/demo/src/scenes/pie.ts"]);
    expect(trace.filter((n) => n.kind === "profile")).toHaveLength(3);
    expect(trace.filter((n) => n.kind === "segment")).toHaveLength(3);
    expect(trace.filter((n) => n.value.kind === "gliderCircle")).toHaveLength(3);
    expect(trace.some((n) => n.bind === "gap" && n.kind === "slider")).toBe(true);
    const one = trace.find((n) => n.bind === "one");
    expect(one?.kind).toBe("profile");
    expect(one?.value.kind === "profile" ? one.value.outer : []).toHaveLength(
      one?.value.kind === "profile" ? 3 : 0,
    );
  });

  test("plate figure paints returned fields from the same helper", () => {
    const { trace } = run(plateFigure, [
      "apps/demo/src/scenes/plate-figure.ts",
      "apps/demo/src/layout/mounting-plate.ts",
    ]);
    expect(trace.filter((n) => n.kind === "paint")).toHaveLength(4);
    expect(trace.filter((n) => n.kind === "style")).toHaveLength(0);
    expect(trace.some((n) => n.bind === "drill" && n.kind === "circle")).toBe(true);
    const paints = paintsFromTrace(trace);
    expect(paints.has("o_drill:0")).toBe(true);
    expect(paints.has("o_origin:0")).toBe(true);
    expect(paints.has("o_in:0")).toBe(true);
    expect(paints.has("o_bot:0")).toBe(false);
  });

  test("fillet scene traces the challenge cases from one radius slider", () => {
    const { trace } = run(fillet, ["apps/demo/src/scenes/fillet.ts"]);
    expect(trace.filter((n) => n.kind === "profile")).toHaveLength(9);
    expect(trace.some((n) => n.bind === "r" && n.kind === "slider")).toBe(true);
    const flat = trace.find((n) => n.bind === "flat");
    expect(flat?.kind).toBe("profile");
    expect(flat?.value.kind === "profile" ? flat.value.outer : []).toHaveLength(
      flat?.value.kind === "profile" ? 3 : 0,
    );
    expect(
      flat?.value.kind === "profile" ? flat.value.outer.filter((e) => e.carrier.kind === "circle") : [],
    ).toHaveLength(flat?.value.kind === "profile" ? 1 : 0);
    const mix = trace.find((n) => n.bind === "mix");
    expect(mix?.kind).toBe("profile");
    expect(mix?.value.kind === "profile" ? mix.value.outer : []).toHaveLength(
      mix?.value.kind === "profile" ? 6 : 0,
    );
    expect(
      mix?.value.kind === "profile" ? mix.value.outer.filter((e) => e.carrier.kind === "circle") : [],
    ).toHaveLength(mix?.value.kind === "profile" ? 2 : 0);
    const ell = trace.find((n) => n.bind === "ell");
    expect(ell?.value.kind === "profile" ? ell.value.outer : []).toHaveLength(
      ell?.value.kind === "profile" ? 7 : 0,
    );
    expect(
      ell?.value.kind === "profile" ? ell.value.outer.filter((e) => e.carrier.kind === "circle") : [],
    ).toHaveLength(ell?.value.kind === "profile" ? 1 : 0);
    const rim = trace.find((n) => n.bind === "rim");
    expect(rim?.value.kind === "profile" ? rim.value.outer : []).toHaveLength(
      rim?.value.kind === "profile" ? 5 : 0,
    );
    const tip = trace.find((n) => n.bind === "tip");
    expect(tip?.value.kind === "profile" ? tip.value.outer : []).toHaveLength(
      tip?.value.kind === "profile" ? 4 : 0,
    );
    const adj = trace.find((n) => n.bind === "adj");
    expect(adj?.value.kind === "profile" ? adj.value.outer : []).toHaveLength(
      adj?.value.kind === "profile" ? 6 : 0,
    );
    const inset = trace.find((n) => n.bind === "inset");
    expect(
      inset?.value.kind === "profile" ? inset.value.outer.filter((e) => e.carrier.kind === "circle") : [],
    ).toHaveLength(inset?.value.kind === "profile" ? 4 : 0);
  });
});
