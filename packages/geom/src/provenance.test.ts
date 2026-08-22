import { expect, test } from "vitest";

import { captureCallSite } from "./provenance";

test("skips geom frames whose path has no leading slash", () => {
  const orig = Error;
  const stack = `Error
    at captureCallSite (packages/geom/src/provenance.ts:48:17)
    at parseFrame (packages/geom/src/provenance.ts:37:13)
    at makeBase (packages/geom/src/identity.ts:160:18)
    at polyline (packages/geom/src/geom.ts:128:8)
    at scene (apps/paper/src/demo/gear.ts:133:22)`;
  // captureCallSite reads `new Error().stack`
  globalThis.Error = class extends orig {
    override stack = stack;
  } as typeof Error;
  try {
    expect(captureCallSite()).toEqual({
      file: "apps/paper/src/demo/gear.ts",
      line: 133,
      column: 22,
    });
  } finally {
    globalThis.Error = orig;
  }
});
