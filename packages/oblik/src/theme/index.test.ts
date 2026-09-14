import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

/**
 * The label pair is checked here rather than by eye, because both ways it can go
 * wrong are silent.
 *
 * The first is an **inversion**: wire the resting label to the stronger token
 * and the hot one to the softer, and hovering a point dims its own label. That
 * is what happened — the pair was `--oblik-text` at rest and `--oblik-ink` for
 * hot, and `--oblik-ink` is the softer of those two in **both** themes.
 *
 * The second is a **collapse**: keep both colours technically ordered but close
 * enough that no one can see the change. A resting label at 7:1 against the
 * paper is still "dark text", so halving it from 14.9:1 looked like nothing at
 * all. Ordering is therefore not the property worth pinning — *separation* is.
 *
 * Lightness is the right measure because the palette is near-achromatic apart
 * from accent, error and paint: a label's legibility is its lightness distance
 * from the paper.
 */

const CSS = readFileSync(new URL("./index.css", import.meta.url), "utf8");

/** The declarations inside one top-level block, by its selector. */
function block(selector: string): Map<string, string> {
  const start = CSS.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`theme has no ${selector} block`);
  const end = CSS.indexOf("\n}", start);
  const body = CSS.slice(CSS.indexOf("{", start) + 1, end);
  const declarations = new Map<string, string>();
  for (const line of body.split("\n")) {
    const match = /^\s*(--[\w-]+):\s*(.+?);\s*$/.exec(line);
    if (match !== null) declarations.set(match[1]!, match[2]!);
  }
  return declarations;
}

/** Follow `var(--x)` chains to a literal, so `--oblik-label: var(--oblik-ink)` resolves. */
function resolve(theme: Map<string, string>, name: string): string {
  let value = theme.get(name);
  for (let hops = 0; value !== undefined && hops < 8; hops += 1) {
    const reference = /^var\((--[\w-]+)\)$/.exec(value.trim());
    if (reference === null) return value.trim();
    value = theme.get(reference[1]!);
  }
  throw new Error(`${name} does not resolve to a literal`);
}

/** The lightness of an `oklch(L …)` value; the palette's only colour space. */
function lightness(value: string): number {
  const match = /^oklch\(\s*([\d.]+)/.exec(value);
  if (match === null) throw new Error(`expected an oklch colour, got ${value}`);
  return Number.parseFloat(match[1]!);
}

/** How far a colour sits from the paper. */
function contrast(theme: Map<string, string>, name: string): number {
  return Math.abs(lightness(resolve(theme, name)) - lightness(resolve(theme, "--oblik-paper")));
}

const THEMES = {
  /*
   * The minimum lightness gap a resting label must keep from a hot one. Dark is
   * deliberately subtle — there, `--oblik-ink` against `--oblik-text` is the
   * whole of the effect. Light has to be obvious, because that is where the
   * ratio was high enough that a real change read as no change.
   */
  dark: { theme: block(":root"), minSeparation: 0.05 },
  light: { theme: block(':root[data-theme="light"]'), minSeparation: 0.25 },
};

describe("label ink", () => {
  for (const [name, { theme, minSeparation }] of Object.entries(THEMES)) {
    test(`${name}: both label tokens are declared`, () => {
      expect(theme.has("--oblik-label")).toBe(true);
      expect(theme.has("--oblik-label-hot")).toBe(true);
    });

    test(`${name}: a hovered label is stronger than a resting one`, () => {
      expect(contrast(theme, "--oblik-label-hot")).toBeGreaterThan(contrast(theme, "--oblik-label"));
    });

    test(`${name}: the two are far enough apart to see`, () => {
      const separation = contrast(theme, "--oblik-label-hot") - contrast(theme, "--oblik-label");
      expect(separation).toBeGreaterThan(minSeparation);
    });

    test(`${name}: labels sit below body text, which is the softer read`, () => {
      // The point of a separate pair: annotations are quieter than content.
      expect(contrast(theme, "--oblik-label")).toBeLessThan(contrast(theme, "--oblik-text"));
    });

    test(`${name}: a resting label still clears the paper`, () => {
      // Softer, not invisible.
      expect(contrast(theme, "--oblik-label")).toBeGreaterThan(0.25);
    });
  }

  test("light changes further than dark", () => {
    const ratio = (entry: (typeof THEMES)["dark"]): number =>
      contrast(entry.theme, "--oblik-label") / contrast(entry.theme, "--oblik-text");
    expect(ratio(THEMES.light)).toBeLessThan(ratio(THEMES.dark));
  });
});
