import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

/**
 * The layer numbering is **one** numbering.
 *
 * Two parallel ones is how the stroke rest band came to ask for layer 0 — a halo
 * width on a cold stroke — and drew nothing at all, which is invisible in every
 * test that reads the implementation's own numbers: the same wrong number looks
 * consistent on both sides of the mistake.
 *
 * So the numbers are defined in `schemas.ts`, the band tables and the one
 * kind-specific map in `bands.ts`, and nothing else in this directory may define
 * either. A module that wants layers goes through the tables.
 */

const here = path.dirname(fileURLToPath(import.meta.url));

type Source = { name: string; text: string };

function readDir(dir: string, prefix = ""): Source[] {
  const out: Source[] = [];
  for (const name of fs.readdirSync(dir)) {
    const abs = path.join(dir, name);
    if (fs.statSync(abs).isDirectory()) {
      out.push(...readDir(abs, `${prefix}${name}/`));
      continue;
    }
    if (!name.endsWith(".ts") || name.endsWith(".test.ts")) continue;
    out.push({ name: `${prefix}${name}`, text: fs.readFileSync(abs, "utf8") });
  }
  return out;
}

const modules = readDir(here);

describe("one layer numbering", () => {
  test("the layer numbers are defined in one module", () => {
    const offenders = modules
      .filter(({ name }) => name !== "schemas.ts")
      .filter(({ text }) => /const\s+LAYER_[A-Z_]+\s*=/.test(text))
      .map(({ name }) => name);
    expect(offenders).toEqual([]);
  });

  test("the band tables, the slot map and the layer count live in one module", () => {
    const definesTables =
      /const\s+(STROKE|POINT|CIRCLE)_BAND_LAYERS\s*[:=]|function\s+inkSlotOf\s*\(|const\s+INK_LAYER_COUNT\s*=/;
    const offenders = modules
      .filter(({ name }) => name !== "bands.ts")
      .filter(({ text }) => definesTables.test(text))
      .map(({ name }) => name);
    expect(offenders).toEqual([]);
  });

  test("nothing keeps a per-kind copy of the numbering", () => {
    // The constants the old records were indexed by, and the two that counted
    // "how many records a node has" instead of asking the tables.
    const banned =
      /const\s+(RING|KNOCKOUT|OUTLINE|PAINT|INK_HALO|INK_KNOCKOUT|INK_PAINT|INK_DISC_COUNT|POINT_DISC_COUNT)\s*=/;
    const offenders = modules.filter(({ text }) => banned.test(text)).map(({ name }) => name);
    expect(offenders).toEqual([]);
  });

  test("both ends of a band read the same table", () => {
    // The adapter decides which bands a node joins and what each band asks for;
    // the painter sizes the draw from that same table. Nothing else may.
    const source = (name: string): string => modules.find((m) => m.name === name)!.text;

    const adapter = source("adapter.ts");
    expect(adapter).toContain('from "./bands"');
    expect(adapter).toMatch(/bandsFor\(/);
    expect(adapter).toMatch(/CIRCLE_BAND_LAYERS\[band\]/);

    const painter = source("painter.ts");
    expect(painter).toMatch(/INK_BAND_ORDER/);
    expect(painter).toMatch(/STROKE_BAND_LAYERS\[band\]/);
    expect(painter).toMatch(/POINT_BAND_LAYERS\[band\]/);
    // The instance multiplier is the table's answer, never a literal.
    expect(painter).toMatch(/instancesPerEntry\(/);
  });
});
