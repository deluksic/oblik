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
  const t = (ring.w * ringCov) / max(ringCov, 1e-6);
  return vec4f(mix(knock.xyz, ring.xyz, t), clamp(ringCov + paperCov, 0, 1));
});
