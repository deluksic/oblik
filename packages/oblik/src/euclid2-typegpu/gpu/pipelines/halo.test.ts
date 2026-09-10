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

/** Mirror of `haloColor`: `(d, ring, knock, half)` → one alpha-blended color. */
function haloAt(inward: number, ring: Rgba, knock: Rgba, knockHalf: number, outHalf: number) {
  const ringCov = band(inward, 0, outHalf);
  const paperCov = band(inward, outHalf, outHalf + knockHalf) * knock[3];
  const t = (ring[3] * ringCov) / Math.max(ringCov, 1e-6);
  const alpha = Math.min(1, ringCov + paperCov);
  return {
    rgb: knock.slice(0, 3).map((c, i) => c + (ring[i]! - c) * t),
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

  test("the band edges are antialiased over one pixel", () => {
    // Half covered exactly at the silhouette: the ring hands the edge over to
    // the fill's own AA ramp rather than cutting it.
    expect(haloAt(0, SELECTED, PAPER_ON, knockHalf, ringHalf).alpha).toBeCloseTo(0.5, 6);
    expect(haloAt(ringHalf, SELECTED, PAPER_OFF, 0, ringHalf).alpha).toBeCloseTo(0.5, 6);
  });
});
