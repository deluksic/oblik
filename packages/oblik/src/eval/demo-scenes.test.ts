import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

import { analyze } from "../source/analyze";
import { evaluate } from "./evaluate";
import mountingPlate from "../../../../apps/demo/src/scenes/mounting-plate.ts";
import sharedLoop from "../../../../apps/demo/src/scenes/shared-loop.ts";
import shelf from "../../../../apps/demo/src/scenes/shelf.ts";
import truss from "../../../../apps/demo/src/scenes/truss.ts";
import type { Euclid2Scene } from "./scene";

const scenesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../apps/demo/src/scenes");

function run(mod: Euclid2Scene, file: string) {
  const src = readFileSync(path.join(scenesDir, file), "utf8");
  return evaluate(mod, { annotations: analyze(src, `apps/demo/src/scenes/${file}`) });
}

describe("migrated demo scenes", () => {
  test("shelf traces cellar via -shelf.distance and a dist() beam", () => {
    const { trace } = run(shelf, "shelf.ts");
    const kinds = trace.map((n) => n.kind);
    expect(kinds.filter((k) => k === "parallelLine")).toHaveLength(2);
    expect(trace.some((n) => n.bind === "cellar" && n.value.kind === "parallelLine")).toBe(true);
    const cellar = trace.find((n) => n.bind === "cellar");
    const shelfN = trace.find((n) => n.bind === "shelf");
    if (cellar?.value.kind === "parallelLine" && shelfN?.value.kind === "parallelLine") {
      expect(cellar.value.distance).toBeCloseTo(-shelfN.value.distance);
    }
    expect(trace.some((n) => n.bind === "lamp" && n.value.kind === "gliderLine")).toBe(true);
    expect(trace.some((n) => n.bind === "beam" && n.kind === "circle")).toBe(true);
    expect(trace.some((n) => n.bind === "Q")).toBe(true);
  });

  test("shared-loop stamps five rings on one id", () => {
    const { trace } = run(sharedLoop, "shared-loop.ts");
    const rings = trace.filter((n) => n.id === "o_ring");
    expect(rings).toHaveLength(5);
    expect(rings.every((n) => n.editable && n.value.kind === "circle")).toBe(true);
  });

  test("truss places gliders on the span", () => {
    const { trace } = run(truss, "truss.ts");
    expect(trace.filter((n) => n.value.kind === "gliderSegment")).toHaveLength(3);
    expect(trace.filter((n) => n.kind === "circle")).toHaveLength(3);
  });

  test("mounting plate reuses inset distance and drill radius", () => {
    const { trace } = run(mountingPlate, "mounting-plate.ts");
    const insets = trace.filter((n) => n.kind === "parallelLine");
    expect(insets).toHaveLength(4);
    const d0 = insets[0]?.value.kind === "parallelLine" ? insets[0].value.distance : null;
    expect(insets.every((n) => n.value.kind === "parallelLine" && n.value.distance === d0)).toBe(true);
    expect(trace.filter((n) => n.kind === "circle")).toHaveLength(4);
  });
});
