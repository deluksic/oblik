import { tgpu } from "typegpu";
import { describe, expect, test } from "vitest";

import { oblikBandFragment, oblikFillFragment } from "./fragment";
import { oblikVertex } from "./shader";

/**
 * The three stages, resolved to WGSL without a device.
 *
 * Two things are worth pinning structurally, because both would come back
 * silently — the labels would still look *plausible*:
 *
 * 1. The camera is applied to the label's **anchor**, and the glyph's own pixels
 *    are added through a separate, camera-free mapping. Collapse that back into
 *    one matrix and the per-frame CPU cost returns.
 * 2. The knockout band and the ink are **separate stages**. Merge them and one
 *    glyph's ring erases the neighbouring glyph wherever kerning overlaps their
 *    boxes.
 */

const code = tgpu.resolve([oblikVertex, oblikBandFragment, oblikFillFragment]);

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/**
 * One entry point's own body. Slicing between markers is not good enough: the
 * shared helpers are emitted alongside the entry points, in an order that is not
 * ours to rely on, so each body is delimited by its own closing brace.
 */
function fnBody(source: string, name: string): string {
  const start = source.indexOf(`fn ${name}(`);
  if (start < 0) throw new Error(`resolved WGSL has no ${name}`);
  const end = source.indexOf("\n}", start);
  if (end < 0) throw new Error(`resolved WGSL has an unterminated ${name}`);
  return source.slice(start, end);
}

const vertexBody = fnBody(code, "oblikVertex");
const bandBody = fnBody(code, "oblikBandFragment");
const fillBody = fnBody(code, "oblikFillFragment");

describe("oblik MSDF WGSL", () => {
  test("all three stages resolve", () => {
    expect(occurrences(code, "@vertex fn")).toBe(1);
    expect(occurrences(code, "@fragment fn")).toBe(2);
    expect(code).not.toContain("undefined");
  });

  test("the camera is applied to the anchor, exactly once", () => {
    expect(occurrences(vertexBody, "(camera * vec4f(")).toBe(1);
    expect(vertexBody).toContain("let anchorClip = (camera * vec4f(anchor.x, anchor.y, 0f, 1f));");
    // And nowhere else in the stage: one read of the matrix, for the anchor.
    expect(occurrences(vertexBody, "camera")).toBe(1);
  });

  test("the glyph quad is camera-free: screen pixels through `view` only", () => {
    const quad = vertexBody.slice(vertexBody.indexOf("let ndc ="));
    expect(quad).toContain("view.x");
    expect(quad).toContain("view.y");
    expect(quad).not.toContain("camera");
    expect(vertexBody).toContain("let screenPx = (px + label.zw);");
  });

  test("the vertex stage dilates the quad by the ring gap", () => {
    expect(vertexBody).toContain("let gap = max((ring.x * ring.y), 0f);");
    expect(vertexBody).toContain("gap * 2f");
    expect(vertexBody).toContain("vec4f(minPx.x, minPx.y, sizePx.x, sizePx.y)");
    expect(vertexBody).not.toContain("uvPerPx");
  });

  test("the band and the ink are separate stages", () => {
    // Two fragment entry points, sharing one vertex stage and one coverage
    // helper — so they cannot disagree about where the glyph is.
    expect(occurrences(code, "fn oblikCoverage(")).toBe(1);
    expect(occurrences(code, "@fragment fn")).toBe(2);
    expect(bandBody).toContain("_arg_0.ringColor");
    expect(bandBody).not.toContain("_arg_0.color");
    expect(fillBody).toContain("_arg_0.color");
    expect(fillBody).not.toContain("_arg_0.ringColor");
  });

  test("each stage keeps only its own coverage", () => {
    // The band takes `coverage.y`, the fill `coverage.x`; neither paints the
    // other's shape.
    expect(bandBody).toContain("coverage.y");
    expect(bandBody).not.toContain("coverage.x");
    expect(fillBody).toContain("coverage.x");
    expect(fillBody).not.toContain("coverage.y");
    // The fill does not even ask for a gap.
    expect(fillBody).toContain("oblikCoverage(");
  });

  test("antialiasing is in pixels, never `fwidth` of the MSDF", () => {
    expect(occurrences(code, "fwidth(")).toBe(0);
    expect(code).toContain("return (((value - 0.5f) * rangePx) - outside);");
    expect(code).toContain("+ 0.5f), 0f, 1f)");
  });

  test("the field is extrapolated past the cell, not smeared", () => {
    expect(code).toContain("let outside = length((localPx - cell));");
    expect(occurrences(code, "textureSample(")).toBe(1);
  });

  test("the atlas read stays inside the cell the baker declared", () => {
    expect(code).toContain("clamp((uvRect.xy + ((cell - minPx) * uvPerPx)), uvBounds.xy, uvBounds.zw)");
    expect(code).toContain("let cell = clamp(localPx, minPx, (minPx + sizePx));");
  });
});
