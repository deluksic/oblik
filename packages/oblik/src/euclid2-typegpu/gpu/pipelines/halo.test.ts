import { describe, expect, test } from "vitest";

import { DEFAULT_CHROME_METRICS, overlayBands } from "../../../euclid2/view/chrome";

/**
 * CPU mirror of `haloColor`'s band math. `wgsl.test.ts` checks the shader's
 * *structure*; this checks its *semantics* — in particular the two decisions
 * that make a hot fill read the way it does:
 *
 * 1. the band is measured **inward from the fill's own edge**, so the outline
 *    sits flush against the silhouette;
 * 2. the band is **opaque and drawn over the paint**: the outline is paper-backed
 *    with the ring color at its own opacity over that, so it knocks the fill out
 *    instead of being tinted by it, and the paper knockout band inside it is a
 *    real hole in the fill.
 *
 * Distances are CSS px inside the shape and `w = 1` (one pixel), like the
 * shader's `fwidth`.
 */

type Rgb = readonly [number, number, number];
type Rgba = readonly [number, number, number, number];

const ACCENT: Rgb = [0.1, 0.2, 0.9];
const PAPER: Rgb = [0.97, 0.97, 0.95];

/** One pixel of antialiasing at each band edge, mirroring `bandCoverage`. */
function band(dist: number, lo: number, hi: number): number {
  return Math.min(1, Math.max(0, dist - lo + 0.5)) * Math.min(1, Math.max(0, hi - dist + 0.5));
}

type Layer = { rgb: number[]; alpha: number };

/** Mirror of `haloColor`: `(d, ring, knock, half)` → one alpha-blended color.
 * The color is area-weighted across the two bands, so it ramps at their seam. */
function haloAt(inward: number, ring: Rgba, knock: Rgba, knockHalf: number, outHalf: number) {
  const ringCov = band(inward, 0, outHalf);
  const paperCov = band(inward, outHalf, outHalf + knockHalf) * knock[3];
  const total = ringCov + paperCov;
  const ringColor = knock.slice(0, 3).map((c, i) => c + (ring[i]! - c) * ring[3]);
  return {
    rgb: ringColor.map((c, i) => (c * ringCov + knock[i]! * paperCov) / Math.max(total, 1e-6)),
    alpha: Math.min(1, total),
  };
}

/** Mirror of `paintWithEdge`: the fill plus its state-colored outline, which
 * straddles the boundary. */
function paintAt(inward: number, fill: Rgba, edge: Rgba, edgeWidth: number): Layer {
  const cov = Math.min(1, Math.max(0, 0.5 + inward));
  const line = band(inward, -edgeWidth / 2, edgeWidth / 2) * edge[3];
  const ea = line;
  const fa = Math.max(cov - line, 0) * fill[3];
  const alpha = ea + fa;
  return {
    rgb: edge.slice(0, 3).map((c, i) => (c * ea + fill[i]! * fa) / Math.max(alpha, 1e-6)),
    alpha,
  };
}

const { outline, knockout } = overlayBands(1.5, { selected: true });
const ringHalf = outline / 2;
const knockHalf = knockout / 2;
const HOVER: Rgba = [...ACCENT, DEFAULT_CHROME_METRICS.hoverOutlineOpacity];
const SELECTED: Rgba = [...ACCENT, DEFAULT_CHROME_METRICS.selectOutlineOpacity];
const PAPER_OFF: Rgba = [...PAPER, 0];
const PAPER_ON: Rgba = [...PAPER, 1];

describe("fill halo bands", () => {
  test("hover: an opaque paper-backed accent band from the edge inward", () => {
    expect(ringHalf).toBe(3.5);
    // Just inside the edge the band is fully opaque — the fill's paint is gone —
    // and reads as the accent at 50% over paper, never as accent under cream.
    const at = haloAt(1, HOVER, PAPER_OFF, 0, ringHalf);
    expect(at.alpha).toBe(1);
    expect(at.rgb[2]).toBeCloseTo(PAPER[2]! + (ACCENT[2]! - PAPER[2]!) * 0.5, 6);
    // Past the band the fill is untouched.
    expect(haloAt(5, HOVER, PAPER_OFF, 0, ringHalf).alpha).toBe(0);
  });

  test("selected: a solid ring, then the paper gap inside it", () => {
    // Ring band: full accent, opaque.
    const ring = haloAt(1, SELECTED, PAPER_ON, knockHalf, ringHalf);
    expect(ring.alpha).toBe(1);
    ring.rgb.forEach((c, i) => expect(c).toBeCloseTo(ACCENT[i]!, 6));
    // Paper band: just inside the ring (3.5 .. 5.5 px), opaque paper.
    const paper = haloAt(4.5, SELECTED, PAPER_ON, knockHalf, ringHalf);
    expect(paper.alpha).toBe(1);
    paper.rgb.forEach((c, i) => expect(c).toBeCloseTo(PAPER[i]!, 6));
    // The fill resumes past it.
    expect(haloAt(6, SELECTED, PAPER_ON, knockHalf, ringHalf).alpha).toBe(0);
  });

  test("every fill carries its own state-colored outline, centred on the edge", () => {
    const fill: Rgba = [0.86, 0.86, 0.86, 0.16];
    const blue: Rgba = [...ACCENT, 1];
    // The construction stroke width (1.5px), straddling the boundary like SVG's
    // stroke, so it lands on the edge that defined the region rather than
    // doubling it just inside.
    const edgeWidth = 1.5;
    // On the boundary the line owns the pixel outright, at full opacity despite
    // the fill's 16%.
    const onEdge = paintAt(0, fill, blue, edgeWidth);
    onEdge.rgb.forEach((c, i) => expect(c).toBeCloseTo(ACCENT[i]!, 6));
    expect(onEdge.alpha).toBe(1);
    // Its outer half reaches *outside* the fill …
    const outside = paintAt(-0.3, fill, blue, edgeWidth);
    expect(outside.alpha).toBeGreaterThan(0.5);
    outside.rgb.forEach((c, i) => expect(c).toBeCloseTo(ACCENT[i]!, 6));
    // … and stops there: beyond the stroke's outer edge (and its antialiasing
    // tail) outside the fill there is nothing at all.
    expect(paintAt(-1.2, fill, blue, edgeWidth).alpha).toBeLessThan(0.1);
    expect(paintAt(-1.5, fill, blue, edgeWidth).alpha).toBe(0);
    // Past the line's inner edge the paint resumes, at its own opacity.
    const inside = paintAt(3, fill, blue, edgeWidth);
    inside.rgb.forEach((c, i) => expect(c).toBeCloseTo(fill[i]!, 6));
    expect(inside.alpha).toBeCloseTo(0.16, 6);
    // A fill with no outline of its own is unchanged: its silhouette alpha is
    // the fill's own opacity scaled by the shape's antialiasing coverage.
    expect(paintAt(0, fill, [0, 0, 0, 0], edgeWidth).alpha).toBeCloseTo(0.08, 6);
    expect(paintAt(1, fill, [0, 0, 0, 0], edgeWidth).alpha).toBeCloseTo(0.16, 6);
  });

  test("no hard step anywhere in the profile", () => {
    // A dense sweep across the whole chrome stack: seam, both band edges, the
    // outline, and out into the fill. The reported bug was a hard paper→ring
    // step at the knockout seam, where the color was picked from the ring's
    // coverage alone — that jumps by the full color distance in one sample.
    const at = (inward: number) => [
      haloAt(inward, SELECTED, PAPER_ON, knockHalf, ringHalf),
      haloAt(inward, HOVER, PAPER_OFF, 0, ringHalf),
      paintAt(inward, [0.86, 0.86, 0.86, 0.16], [...ACCENT, 1], 1.5),
    ];
    // Each scenario is its own profile: the three are different stacks, so only
    // steps *within* one are meaningful. Colors are compared premultiplied,
    // because `rgb * alpha` is all the blend sees — a color swing under a zero
    // alpha is not a visible step.
    const worst = [0, 1, 2].map((k) => {
      let step = 0;
      let prev = at(-2)[k]!;
      for (let inward = -1.95; inward <= 10; inward += 0.05) {
        const next = at(inward)[k]!;
        step = Math.max(step, Math.abs(prev.alpha - next.alpha));
        for (let c = 0; c < 3; c++) {
          step = Math.max(step, Math.abs(prev.rgb[c]! * prev.alpha - next.rgb[c]! * next.alpha));
        }
        prev = next;
      }
      return step;
    });
    // One 0.05px sample of a 0.87-wide color distance is ~0.044; the old hard
    // step measured the whole 0.87.
    worst.forEach((step) => expect(step).toBeLessThan(0.1));
  });

  test("the band edges are antialiased over one pixel", () => {
    // Half covered exactly at the silhouette: the ring hands the edge over to
    // the fill's own AA ramp rather than cutting it.
    expect(haloAt(0, SELECTED, PAPER_ON, knockHalf, ringHalf).alpha).toBeCloseTo(0.5, 6);
    expect(haloAt(ringHalf, SELECTED, PAPER_OFF, 0, ringHalf).alpha).toBeCloseTo(0.5, 6);
  });
});
