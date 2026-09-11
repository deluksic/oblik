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

  test("the fragment desaturates, then fades toward the paper", () => {
    expect(occurrences(code, "textureSample(")).toBe(1);
    expect(occurrences(code, "dot(")).toBe(1);
    expect(code).toContain("0.2125999927520752");
    expect(code).toContain("0.85f");
    expect(occurrences(code, "mix(")).toBe(2);
    expect(code).toContain("theme.paper");
  });

  test("fade is flat across the quad and alpha is the bitmap's own", () => {
    expect(occurrences(code, "@interpolate(flat) fade")).toBe(2);
    expect(code).toContain("sampled.a");
  });
});
