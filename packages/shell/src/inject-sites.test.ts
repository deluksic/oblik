import { expect, test } from "vitest";
import { injectSceneSites } from "./inject-sites.ts";
import { patchWidgetAt } from "./patch-widget.ts";

test("mints one UUID per CallExpression, including a looped call", () => {
  const src = `export function scene() {
  const o = editPoint(0, 0);
  for (let i = 0; i < 5; i++) {
    editDistanceToPoint(o, 0.4);
  }
}
`;
  let n = 0;
  const out = injectSceneSites(src, () => `id-${n++}`);
  expect(n).toBe(2);
  expect(out).toMatch(/editPoint\(0, 0, \{ id: "id-0", at: \[\d+, \d+\] \}\)/);
  expect(out).toMatch(
    /editDistanceToPoint\(o, 0\.4, \{ id: "id-1", at: \[\d+, \d+\] \}\)/,
  );
  expect(out.match(/id-\d+/g)?.length).toBe(2);
});

test("merges id/at into an existing last object literal", () => {
  const src = `editNumber(3, { label: "N" });\n`;
  const out = injectSceneSites(src, () => "num-id");
  expect(out).toMatch(
    /editNumber\(3, \{ id: "num-id", at: \[\d+, \d+\], label: "N" \}\)/,
  );
});

test("injects editVector site as a last argument", () => {
  const src = `editVector(a, 2.4, 1.05);\n`;
  const out = injectSceneSites(src, () => "vec-id");
  expect(out).toMatch(
    /editVector\(a, 2\.4, 1\.05, \{ id: "vec-id", at: \[\d+, \d+\] \}\)/,
  );
});

test("baked at matches the CallExpression on the original source", () => {
  const src = `import { type Vec2 } from "@design-scenes/geom";
const a: Vec2 = editPoint(-2.2, 0.15);
`;
  const out = injectSceneSites(src, () => "pt");
  const m = out.match(/at: \[(\d+), (\d+)\]/);
  expect(m).toBeTruthy();
  const next = patchWidgetAt(src, Number(m![1]), Number(m![2]), [1, 2]);
  expect(next).toMatch(/editPoint\(1, 2\)/);
});
