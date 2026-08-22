import { expect, test } from "vitest";

import { annotateCallSites } from "./inject-sites";
import { patchWidgetAt } from "./patch-widget";
import { CALL_SITES, callSiteSpec, patchSpan, SITE_CALL_NAMES, WRITABLE_CALL_NAMES } from "./call-sites";

test("every writable site has a consecutive patch span; dof sites are known", () => {
  for (const spec of CALL_SITES) {
    expect(callSiteSpec(spec.name)).toBe(spec);
    expect(SITE_CALL_NAMES.has(spec.name)).toBe(true);
    const span = patchSpan(spec);
    if (spec.patch?.length) {
      expect(WRITABLE_CALL_NAMES.has(spec.name)).toBe(true);
      expect(span).toEqual({ start: spec.patch[0], count: spec.patch.length });
    } else {
      expect(span).toBeUndefined();
      expect(WRITABLE_CALL_NAMES.has(spec.name)).toBe(false);
    }
  }
});

test("annotator and patcher both follow CALL_SITES — add a row, not a third list", () => {
  const src = `const a = point(1, 2);
const c = circle(a, 3);
const s = slider(0.5);
line(a, c.center);
`;
  const out = annotateCallSites(src, "t.ts").code;
  expect(out).toMatch(/point\(1, 2, \{ __annotations__: \{ file: "t.ts", at: \[\d+, \d+\], editable: true \} \}\)/);
  expect(out).toMatch(/circle\(a, 3, \{ __annotations__: \{ file: "t.ts", at: \[\d+, \d+\], editable: true \} \}\)/);
  expect(out).toMatch(/slider\(0\.5, \{ __annotations__: \{ file: "t.ts", at: \[\d+, \d+\], editable: true \} \}\)/);
  expect(out).toMatch(/line\(a, c\.center, \{ __annotations__: \{ file: "t.ts", at: \[\d+, \d+\], editable: false \} \}\)/);

  const pointAt = out.match(/point\(1, 2, \{ __annotations__: \{ file: "t.ts", at: \[(\d+), (\d+)\]/)!;
  expect(patchWidgetAt(src, Number(pointAt[1]), Number(pointAt[2]), [9, 8])).toMatch(/point\(9, 8\)/);
});
