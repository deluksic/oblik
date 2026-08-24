import { expect, test } from "vitest";

import { annotateCallSites, injectSceneSites } from "./inject-sites";
import { patchWidgetAt } from "./patch-widget";

const SCENE = "apps/paper/src/scenes/shared-loop.scene.ts";

test("injects file and at per CallExpression, including a looped call", () => {
  const src = `export function scene() {
  const o = point(0, 0);
  for (let i = 0; i < 5; i++) {
    circle(o, 0.4);
  }
}
`;
  const out = injectSceneSites(src, SCENE);
  expect(out).toMatch(
    new RegExp(
      `point\\(0, 0, \\{ __annotations__: \\{ file: ${JSON.stringify(SCENE)}, at: \\[\\d+, \\d+\\], editable: true \\} \\}\\)`,
    ),
  );
  expect(out).toMatch(
    /circle\(o, 0\.4, \{ __annotations__: \{ file: .+, at: \[\d+, \d+\], editable: true \} \}\)/,
  );
  expect(out.match(/file:/g)?.length).toBe(2);
});

test("merges file/at into an existing last object literal", () => {
  const src = `slider(3, { label: "N" });\n`;
  const out = injectSceneSites(src, SCENE);
  expect(out).toMatch(
    new RegExp(
      `slider\\(3, \\{ label: "N", __annotations__: \\{ file: ${JSON.stringify(SCENE)}, at: \\[\\d+, \\d+\\], editable: true \\} \\}\\)`,
    ),
  );
});

test("injects vector site as a last argument", () => {
  const src = `vector(a, 2.4, 1.05);\n`;
  const out = injectSceneSites(src, SCENE);
  expect(out).toMatch(
    /vector\(a, 2\.4, 1\.05, \{ __annotations__: \{ file: .+, at: \[\d+, \d+\], editable: true \} \}\)/,
  );
});

test("baked at matches the CallExpression on the original source", () => {
  const src = `import { type Vec2 } from "@design-scenes/geom";
const a: Vec2 = point(-2.2, 0.15);
`;
  const out = injectSceneSites(src, SCENE);
  const m = out.match(/at: \[(\d+), (\d+)\]/);
  expect(m).toBeTruthy();
  const next = patchWidgetAt(src, Number(m![1]), Number(m![2]), [1, 2]);
  expect(next).toMatch(/point\(1, 2\)/);
});

test("injects construction sites onto scene geom constructors", () => {
  const src = `return [segment(c, p), line(a, b)];\n`;
  const out = injectSceneSites(src, SCENE);
  expect(out).toMatch(/line\(a, b, \{ __annotations__: \{ file: .+, at: \[\d+, \d+\], editable: false \} \}\)/);
  expect(out).toContain("segment(c, p)");
});

test("injects helper files outside the catalog", () => {
  const helper = "apps/paper/src/scenes/plate-layout.ts";
  const src = `export function plateLayout() {
  const min = point(-5.5, -3.2);
}
`;
  const out = injectSceneSites(src, helper);
  expect(out).toMatch(
    new RegExp(
      `point\\(-5\\.5, -3\\.2, \\{ __annotations__: \\{ file: ${JSON.stringify(helper)}, at: \\[\\d+, \\d+\\], editable: true \\} \\}\\)`,
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

test("line identity site is the CallExpression line in the original source", () => {
  const src = `function axis() {
  return line(a, b);
}
`;
  const out = injectSceneSites(src, SCENE);
  expect(out).toMatch(
    /line\(a, b, \{ __annotations__: \{ file: .+, at: \[2, \d+\], editable: false \} \}\)/,
  );
});

test("replaces a user __annotations__ bag and warns", () => {
  const src = `point(0, 0, { __annotations__: { file: "nope", at: [1, 1], editable: true } });\n`;
  const r = annotateCallSites(src, SCENE);
  expect(r.warnings).toHaveLength(1);
  expect(r.code).toMatch(new RegExp(`file: ${JSON.stringify(SCENE)}`));
  expect(r.code).not.toMatch(/nope/);
});

test("slider options keep the value editable", () => {
  const src = `slider(1.8, { label: "reach", min: 0, max: 4 });\n`;
  const out = injectSceneSites(src, SCENE);
  expect(out).toMatch(
    /slider\(1\.8, \{ label: "reach", min: 0, max: 4, __annotations__: \{ file: .+, at: \[\d+, \d+\], editable: true \} \}\)/,
  );
});

test("paired offset helper keeps offsetLine distance editable", () => {
  const src = `const pairedOffset = (base, mirror = false) => offsetLine(base, 1.76, { mirror });
const shelf = pairedOffset(ground);
pairedOffset(ground, true);
`;
  const out = injectSceneSites(src, SCENE);
  expect(out).toMatch(
    /offsetLine\(base, 1\.76, \{ mirror, __annotations__: \{ file: .+, at: \[\d+, \d+\], editable: true \} \}\)/,
  );
});

test("perpendicularLine has a construction site but no editable dof", () => {
  const src = `const perpLn = perpendicularLine(ground, P);\n`;
  const out = injectSceneSites(src, SCENE);
  expect(out).toMatch(
    /perpendicularLine\(ground, P, \{ __annotations__: \{ file: .+, at: \[\d+, \d+\], editable: false \} \}\)/,
  );
});

test("wraps const name = ident(...) so nested constructors inherit bind", () => {
  const src = `const entrySwing = doorOpen(hinge);\n`;
  const out = injectSceneSites(src, SCENE);
  expect(out).toContain(
    `import { pushBind as __ds_pushBind, popBind as __ds_popBind } from "@design-scenes/geom";`,
  );
  expect(out).toContain(
    `const entrySwing = (__ds_pushBind("entrySwing"), __ds_popBind(doorOpen(hinge)))`,
  );
});

test("does not wrap method calls or let bindings", () => {
  const src = `const hit = rooms.find((r) => r.id === id);
let tmp = point(0, 0);
`;
  const out = injectSceneSites(src, SCENE);
  expect(out).not.toContain(`__ds_pushBind("hit")`);
  expect(out).not.toContain(`__ds_pushBind("tmp")`);
  expect(out).toMatch(/point\(0, 0, \{ __annotations__/);
});
