import { tgpu } from "typegpu";
import { f32, vec2f, vec4f } from "typegpu/data";
import { clamp, fwidth, max, mix } from "typegpu/std";

/** Coverage of the `lo..hi` band of a boundary distance, antialiased at both
 * edges. `w` is one pixel in world units (`fwidth` of the distance), so a band
 * is a screen-space width at any zoom, like the SVG's non-scaling stroke. */
const bandCoverage = tgpu.fn(
  [f32, f32, f32, f32],
  f32,
)((dist, lo, hi, w) => {
  "use gpu";
  return clamp((dist - lo) / w + 0.5, 0, 1) * clamp((hi - dist) / w + 0.5, 0, 1);
});

/**
 * Chrome band of a fill boundary, measured **inward** from the fill's own edge,
 * and drawn *over* the fill's paint so the band **knocks the fill out** instead
 * of being washed by it:
 *
 * - the outline covers the first `outHalf` — paper-backed, then the ring color
 *   at its own opacity, so hover reads as a clean 50% ring and selection as a
 *   solid one, never as accent-under-cream;
 * - the paper knockout covers the next `knockHalf`, which is the gap that keeps
 *   the ring legible against the fill's interior.
 *
 * Widths come from the same tokens as the SVG chrome (`outlinePx`,
 * `knockoutPx`), so a hot fill carries the same weight as a hot edge. A
 * distance field gives the shapes directly: `d` is signed (negative inside) and
 * its magnitude is the distance to the nearest boundary, so an inner stroke is
 * a band of `-d` — round joins, hole boundaries and rounded offsets all fall
 * out of the field with no restroke geometry, no mask and no clip. A zero
 * opacity disables a band: hover draws the outline with no paper gap, and a
 * cold node draws neither.
 *
 * Every fill also carries its own state-colored outline (see `edgeLine`), which
 * is composited here so it stays above the halo, as in the SVG view.
 *
 * The SVG view strokes the same path and clips it to the *outside* of the fill,
 * under the paint; here the band is inside and over it, so it never spills onto
 * the grid or neighbouring geometry and the ring keeps full strength, at the
 * cost of saturating on shapes thinner than the band (which then read as solid
 * ring).
 */
export const haloColor = tgpu.fn(
  [f32, vec4f, vec4f, vec2f],
  vec4f,
)((d, ring, knock, half) => {
  "use gpu";
  const dist = -d;
  const w = max(fwidth(d), 1e-6);
  // The outline band is always on: the adapter only emits a halo run for a node
  // whose ring opacity is non-zero. Its coverage stays pure geometry so the band
  // is opaque paper with the ring color at `ring.w` over it, which is what
  // knocks the fill's paint out. The paper band is gated by its own opacity
  // (0 = hover, no gap), which also keeps a zero-width band from leaving a
  // hairline.
  const ringCov = bandCoverage(dist, 0, half.y, w);
  const paperCov = bandCoverage(dist, half.y, half.y + half.x, w) * knock.w;
  // Area-weighted color: a pixel at the seam is part ring, part paper, so the
  // color has to ramp with the two coverages. Picking it from the ring's
  // coverage alone (which is still what `cover`-style code is tempted to do)
  // would step hard from paper to ring the moment that coverage left zero.
  const total = ringCov + paperCov;
  const ringColor = mix(knock.xyz, ring.xyz, ring.w);
  return vec4f((ringColor * ringCov + knock.xyz * paperCov) / max(total, 1e-6), clamp(total, 0, 1));
});

/** Where the fill's own outline sits: a line straddling the boundary, in the
 * node's state color — the SVG `inkClass` stroke (`ink`, accent when editable,
 * `selectedPaint` when hot) the SVG view draws along a fill's boundary. It is
 * centred like that stroke, so on the straight runs it lands exactly on the edge
 * that defined the region (and under the ink drawn there) instead of doubling it
 * with a second line just inside; where the boundary pulls away from the ink —
 * an offset's rounded corners, a hole — it shows on its own. */
const edgeCoverage = tgpu.fn(
  [f32, f32],
  f32,
)((d, edgeWidth) => {
  "use gpu";
  const half = edgeWidth * 0.5;
  return bandCoverage(d, -half, half, max(fwidth(d), 1e-6));
});

/**
 * Fill paint plus its state-colored outline, from one distance — the paint
 * layer's whole output. A pixel at the boundary is part line, part fill, or
 * both, so this is one area-weighted layer rather than two stacked blends:
 * compositing them separately double-counts the boundary pixel and hardens the
 * silhouette instead of keeping the shape's own antialiasing ramp.
 *
 * The line straddles the boundary (and so reaches outside the fill), which is
 * why the fill's own alpha gives way to it where they overlap: `line * edge.w`
 * is the part of the pixel the line claims.
 */
export const paintWithEdge = tgpu.fn(
  [f32, vec4f, vec4f, f32],
  vec4f,
)((d, fill, edge, edgeWidth) => {
  "use gpu";
  const cov = clamp(0.5 - d / max(fwidth(d), 1e-6), 0, 1);
  const line = edgeCoverage(d, edgeWidth) * edge.w;
  const ea = line;
  const fa = max(cov - line, 0) * fill.w;
  const alpha = ea + fa;
  return vec4f((edge.xyz * ea + fill.xyz * fa) / max(alpha, 1e-6), alpha);
});

/** Halo band plus the outline over it: SVG draws a fill's stroke above its own
 * halo, so a hot fill keeps its state color on the silhouette (cream) with the
 * accent ring just inside it. The band's coverage is the union (the line is
 * narrower and sits inside it), so only the color mixes. */
export const haloWithEdge = tgpu.fn(
  [f32, vec4f, vec4f, vec2f, vec4f, f32],
  vec4f,
)((d, ring, knock, half, edge, edgeWidth) => {
  "use gpu";
  const band = haloColor(d, ring, knock, half);
  const t = clamp(edgeCoverage(d, edgeWidth) / max(band.w, 1e-6), 0, 1) * edge.w;
  return vec4f(mix(band.xyz, edge.xyz, t), band.w);
});
