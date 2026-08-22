import { expect, test } from "vitest";

import { annotateCallSites, injectSceneSites } from "./inject-sites";
import { patchWidgetAt } from "./patch-widget";

const SCENE = "apps/paper/src/scenes/shared-loop.scene.ts";

test("injects file and at per CallExpression, including a looped call", () => {
  const src = `export function scene() {
  const o = editPoint(0, 0);
  for (let i = 0; i < 5; i++) {
    editDistanceToPoint(o, 0.4);
  }
}
`;
  const out = injectSceneSites(src, SCENE);
  expect(out).toMatch(
    new RegExp(
      `editPoint\\(0, 0, \\{ __annotations__: \\{ file: ${JSON.stringify(SCENE)}, at: \\[\\d+, \\d+\\], editable: true \\} \\}\\)`,
    ),
  );
  expect(out).toMatch(
    /editDistanceToPoint\(o, 0\.4, \{ __annotations__: \{ file: .+, at: \[\d+, \d+\], editable: true \} \}\)/,
  );
  expect(out.match(/file:/g)?.length).toBe(2);
});

test("merges file/at into an existing last object literal", () => {
  const src = `editNumber(3, { label: "N" });\n`;
  const out = injectSceneSites(src, SCENE);
  expect(out).toMatch(
    new RegExp(
      `editNumber\\(3, \\{ label: "N", __annotations__: \\{ file: ${JSON.stringify(SCENE)}, at: \\[\\d+, \\d+\\], editable: true \\} \\}\\)`,
    ),
  );
});

test("injects editVector site as a last argument", () => {
  const src = `editVector(a, 2.4, 1.05);\n`;
  const out = injectSceneSites(src, SCENE);
  expect(out).toMatch(
    /editVector\(a, 2\.4, 1\.05, \{ __annotations__: \{ file: .+, at: \[\d+, \d+\], editable: true \} \}\)/,
  );
});

test("baked at matches the CallExpression on the original source", () => {
  const src = `import { type Vec2 } from "@design-scenes/geom";
const a: Vec2 = editPoint(-2.2, 0.15);
`;
  const out = injectSceneSites(src, SCENE);
  const m = out.match(/at: \[(\d+), (\d+)\]/);
  expect(m).toBeTruthy();
  const next = patchWidgetAt(src, Number(m![1]), Number(m![2]), [1, 2]);
  expect(next).toMatch(/editPoint\(1, 2\)/);
});

test("injects construction sites onto scene geom constructors", () => {
  const src = `return group(() => [segment(c, p), line(a, b)]);\n`;
  const out = injectSceneSites(src, SCENE);
  expect(out).toMatch(/segment\(c, p, \{ __annotations__: \{ file: .+, at: \[\d+, \d+\], editable: false \} \}\)/);
  expect(out).toMatch(/line\(a, b, \{ __annotations__: \{ file: .+, at: \[\d+, \d+\], editable: false \} \}\)/);
});

test("injects helper files outside the catalog", () => {
  const helper = "apps/paper/src/scenes/plate-layout.ts";
  const src = `export function plateLayout() {
  const min = editPoint(-5.5, -3.2);
}
`;
  const out = injectSceneSites(src, helper);
  expect(out).toMatch(
    new RegExp(
      `editPoint\\(-5\\.5, -3\\.2, \\{ __annotations__: \\{ file: ${JSON.stringify(helper)}, at: \\[\\d+, \\d+\\], editable: true \\} \\}\\)`,
    ),
  );
});

test("circle radius literal is editable; dist() is not", () => {
  const src = `circle(c, 2.5);\ncircle(c, dist(c, q));\n`;
  const out = injectSceneSites(src, SCENE);
  expect(out).toMatch(/circle\(c, 2\.5, \{ __annotations__: \{ file: .+, at: \[\d+, \d+\], editable: true \} \}\)/);
  expect(out).toMatch(
    /circle\(c, dist\(c, q\), \{ __annotations__: \{ file: .+, at: \[\d+, \d+\], editable: false \} \}\)/,
  );
});

test("public editable: false freezes a literal", () => {
  const src = `circle(c, 2.5, { editable: false });\n`;
  const out = injectSceneSites(src, SCENE);
  expect(out).toMatch(/editable: false, __annotations__: \{ file: .+, at: \[\d+, \d+\], editable: false \}/);
});

test("replaces a user __annotations__ bag and warns", () => {
  const src = `point(0, 0, { __annotations__: { file: "nope", at: [1, 1], editable: true } });\n`;
  const r = annotateCallSites(src, SCENE);
  expect(r.warnings).toHaveLength(1);
  expect(r.code).toMatch(new RegExp(`file: ${JSON.stringify(SCENE)}`));
  expect(r.code).not.toMatch(/nope/);
});
