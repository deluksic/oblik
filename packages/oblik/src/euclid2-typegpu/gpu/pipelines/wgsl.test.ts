import { tgpu } from "typegpu";
import { describe, expect, test } from "vitest";

import { circleVertex } from "./circles";
import { diskVertex } from "./disks";
import { fillFragment, haloFragment } from "./fills";
import { imageFragment, imageVertex } from "./images";
import { strokeVertex } from "./strokes";

/**
 * The span-pass fragments, resolved device-free. The interesting property is
 * structural: segments and arcs are separate arrays with separate windows, so
 * the segment loop — the one a 350-span polygon fill spends its time in — reads
 * 16 B endpoint records and contains no carrier work at all. The halo fragment
 * draws a band of that same distance field, so it must reuse one walk.
 */

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe("span fill WGSL", () => {
  const code = tgpu.resolve([fillFragment]);
  /** Both layers in one resolution: the walk is emitted once, not twice. */
  const bothLayers = tgpu.resolve([fillFragment, haloFragment]);

  test("both record kinds are walked, each from its own window", () => {
    expect(code).toContain("@fragment fn");
    expect(code).not.toContain("undefined");
    expect(occurrences(code, "for (var")).toBe(2);
    expect(occurrences(code, "fillSegs[")).toBe(1);
    expect(occurrences(code, "fillArcs[")).toBe(1);
    // The pre-split combined record and its window are gone.
    expect(code).not.toContain("edgeOffset");
    expect(code).not.toContain("edgeCount");
    expect(code).not.toContain("fillEdges");
  });

  test("the segment loop carries nothing but endpoints", () => {
    const segLoop = code.slice(code.indexOf("fillSegs["), code.indexOf("fillArcs["));
    expect(segLoop).not.toMatch(/atan2|sqrt|radius|center/);
    // Ends at the arc window, i.e. the two loops really are separate.
    expect(segLoop).toContain("arcOffset");
  });

  test("the arc loop keeps the carrier math behind its window", () => {
    const arcLoop = code.slice(code.indexOf("fillArcs["));
    expect(arcLoop).toContain("atan2");
    expect(arcLoop).toContain("sqrt");
    expect(arcLoop).toContain("radius");
  });

  test("the halo layer rides the same walk and samples the halo fields", () => {
    // Two fragments, one boundary walk: the halo is a band of the fill's own
    // distance, not a second pass over the spans.
    expect(occurrences(bothLayers, "@fragment fn")).toBe(2);
    expect(occurrences(bothLayers, "for (var")).toBe(2);
    expect(occurrences(bothLayers, "fillSegs[")).toBe(1);
    expect(occurrences(bothLayers, "fillArcs[")).toBe(1);
    // Paint reads the fill color; the halo reads its band, from `haloHalf`
    // (knockout, ring) and the two halo colors. One read each: the other
    // occurrence of those names is the record declaration itself.
    expect(occurrences(bothLayers, "(*region).haloRing")).toBe(1);
    expect(occurrences(bothLayers, "(*region).haloKnock")).toBe(1);
    expect(occurrences(bothLayers, "(*region).haloHalfPx")).toBe(1);
    expect(bothLayers).toContain("fwidth");
  });
});

/**
 * Widths are CSS px in the records and become world units in the shader, once,
 * through `worldPerPx`. That is what makes a zoom a frame-uniform write instead
 * of a record rewrite (see `adapter.test.ts`), so it is worth pinning: the WGSL
 * has to declare px fields and divide by the frame's scale at every use.
 */
describe("record widths are CSS px", () => {
  test("the span fill scales its outline and halo bands by the zoom", () => {
    const wgsl = tgpu.resolve([haloFragment]);
    expect(occurrences(wgsl, "edgeWidthPx: f32")).toBe(1);
    expect(occurrences(wgsl, "haloHalfPx: vec2f")).toBe(1);
    expect(occurrences(wgsl, "worldPerPx(frame.scale)")).toBe(1);
    // Every width read goes through the conversion, never the raw px value.
    expect(wgsl).toContain("((*region).haloHalfPx * w)");
    expect(wgsl).toContain("((*region).edgeWidthPx * w)");
  });

  test("the stroke vertex shader converts all four ctrl radii", () => {
    const wgsl = tgpu.resolve([strokeVertex]);
    expect(occurrences(wgsl, "radiusPx: f32")).toBe(1);
    // Four cull reads by name, then every radius that reaches the expander goes
    // through the px→world conversion: two for the two-point pair, four for the
    // mirrored-neighbour quad. One shared conversion for all six.
    expect(occurrences(wgsl, "radiusPx * w")).toBe(6);
    expect(occurrences(wgsl, "radiusPx < 0f")).toBe(4);
    expect(occurrences(wgsl, "worldPerPx(frame.scale)")).toBe(1);
  });

  test("the disk vertex shader converts its px radius", () => {
    const wgsl = tgpu.resolve([diskVertex]);
    expect(occurrences(wgsl, "radiusPx: f32")).toBe(1);
    expect(wgsl).toContain("worldPerPx(frame.scale)");
  });

  test("the circle vertex shader derives the band and the fan budget", () => {
    const wgsl = tgpu.resolve([circleVertex]);
    // The record carries the node's world radius and a px band; the piece count
    // that used to be baked per zoom is now derived from both, at draw time.
    expect(occurrences(wgsl, "halfPx: f32")).toBe(1);
    expect(wgsl).toContain("ceil");
    expect(wgsl).toContain("clamp");
    expect(wgsl).not.toMatch(/\bpieces: f32/);
    expect(wgsl).toMatch(/let pieces = clamp\(ceil\(/);
    // The band is px→world, the outline cull keys off the px band.
    expect(wgsl).toContain("((*inst).halfPx * worldPerPx(frame.scale))");
    expect(wgsl).toContain("((*inst).halfPx <= 0f)");
  });
});

/**
 * The reference layer, resolved device-free. Two properties matter. The quad
 * arrives already rotated and flipped, so the shader must contain no rotation
 * and no flip flag — that is what keeps the CPU's geometry and the drawn
 * geometry the same thing. And the look is exactly two mixes: desaturate, then
 * toward the paper, with the bitmap's own alpha kept.
 */
describe("image WGSL", () => {
  const code = tgpu.resolve([imageVertex, imageFragment]);

  test("one instance read, corners picked with select, no rotation left", () => {
    expect(code).toContain("@vertex fn");
    expect(code).not.toContain("undefined");
    expect(occurrences(code, "images[")).toBe(1);
    // Four corners, two selects deep: a ternary over whole storage records is
    // rejected by TGSL, which is what the layered `select` is for.
    expect(occurrences(code, "select(")).toBe(5);
    expect(code).toContain("vec2f(x, y)");
    expect(code).not.toMatch(/\b(rot|flip)\b/);
  });

  /**
   * The uv table is where "upright" is decided, and getting it backwards draws
   * the picture upside down without failing anything: vertex 0 is the rect's
   * screen *bottom*-left (world y runs up), so it samples the texture's bottom
   * row — `select(1f, 0f, ...)`, not the other way round. `IMAGE_QUAD_UVS` in
   * `eval/image.ts` is the same table.
   */
  test("the uv table reads world y as screen up", () => {
    // u: the right-hand pair of the strip order is vertices 1 and 3.
    expect(code).toContain("select(0f, 1f, ((vertexIndex == 1u) || (vertexIndex == 3u)))");
    expect(code).not.toContain("((vertexIndex == 1u) || (vertexIndex == 2u))");
    // v: the bottom row of the texture is the rect's bottom edge, vertices 0-1.
    expect(code).toContain("select(1f, 0f, (vertexIndex >= 2u))");
    expect(code).not.toContain("select(0f, 1f, (vertexIndex >= 2u))");
  });

  test("the fragment applies saturation, contrast, then opacity", () => {
    expect(occurrences(code, "textureSample(")).toBe(1);
    expect(occurrences(code, "dot(")).toBe(1);
    expect(code).toContain("0.2125999927520752");
    // Luma is what "grey" means to the saturation mix; contrast scales about
    // mid-grey; opacity is the alpha, so the blend does the paper mixing and the
    // shader needs no paper colour at all.
    expect(code).toContain("mix(vec3f(dot(");
    expect(code).toContain("- 0.5f) * ");
    expect(code).toContain("saturate(");
    expect(code).toContain("sampled.a * ");
    // Nothing reads a paper *colour* any more: the one that used to be mixed in
    // for `fade` is gone, and fading is alpha against the cleared attachment.
    // (The halo's knockout band carries the paper colour in its own field.)
    expect(code).not.toContain("theme.paper");
    expect(code).toContain("let alpha = (chrome.w + ");
    // The dials are per-instance constants, so they ride flat varyings rather
    // than being interpolated corner to corner — and they travel *by name*: the
    // record's `ImageStyleFields` keeps `opacity`/`saturation`/`contrast`
    // apart, and a WGSL varying cannot be a struct, so the flattening happens
    // here rather than in the schema.
    expect(occurrences(code, "@interpolate(flat) opacity")).toBe(2);
    expect(occurrences(code, "@interpolate(flat) saturation")).toBe(2);
    expect(occurrences(code, "@interpolate(flat) contrast")).toBe(2);
    expect(occurrences(code, "@interpolate(flat) style")).toBe(0);
    expect(code).toContain("(*inst).style.opacity");
  });

  /**
   * The selection chrome is the *same* code a fill's boundary runs: the fragment
   * calls `haloColor` and `edgeCoverage` from `halo.ts` on a distance measured
   * from the quad's border. The only new thing is that distance — CSS px, from
   * the rect's own size and the frame's zoom, so a zoom never rewrites a record.
   * A cold reference has zero-coverage chrome and comes out as the two mixes.
   */
  test("the chrome is the fill's halo, driven by a border distance in px", () => {
    expect(occurrences(code, "fn haloColor(")).toBe(1);
    expect(occurrences(code, "fn edgeCoverage(")).toBe(1);
    expect(occurrences(code, "haloColor(")).toBe(2);
    expect(occurrences(code, "edgeCoverage(")).toBe(2);
    // The distance: the uv inset scaled to px through the rect's world size.
    expect(code).toContain(
      "min((min(uv.x, (1f - uv.x)) * size.x), (min(uv.y, (1f - uv.y)) * size.y))",
    );
    expect(code).toContain("let inset =");
    expect(code).toContain("(inset / worldPerPx(scale))");
    // Negative inside, the convention both fill functions take.
    expect(code).toContain("let d = -(borderPx(");
    expect(code).toContain("edgeWidthPx");
    expect(occurrences(code, "@interpolate(flat) haloRing")).toBe(2);
  });
});
