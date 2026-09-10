import { tgpu } from "typegpu";
import { describe, expect, test } from "vitest";

import { fillFragment } from "./fills";

/**
 * The span-pass fragment, resolved device-free. The interesting property is
 * structural: segments and arcs are separate arrays with separate windows, so
 * the segment loop — the one a 350-span polygon fill spends its time in — reads
 * 16 B endpoint records and contains no carrier work at all.
 */

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe("span fill WGSL", () => {
  const code = tgpu.resolve([fillFragment]);

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
});
