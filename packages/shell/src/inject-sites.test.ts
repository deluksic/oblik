import { expect, test } from "vitest";
import { injectSceneSites } from "./inject-sites.ts";
import { patchWidgetAt } from "./patch-widget.ts";

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
      `editPoint\\(0, 0, \\{ file: ${JSON.stringify(SCENE)}, at: \\[\\d+, \\d+\\] \\}\\)`,
    ),
  );
  expect(out).toMatch(
    /editDistanceToPoint\(o, 0\.4, \{ file: .+, at: \[\d+, \d+\] \}\)/,
  );
  expect(out.match(/file:/g)?.length).toBe(2);
});

test("merges file/at into an existing last object literal", () => {
  const src = `editNumber(3, { label: "N" });\n`;
  const out = injectSceneSites(src, SCENE);
  expect(out).toMatch(
    new RegExp(
      `editNumber\\(3, \\{ file: ${JSON.stringify(SCENE)}, at: \\[\\d+, \\d+\\], label: "N" \\}\\)`,
    ),
  );
});

test("injects editVector site as a last argument", () => {
  const src = `editVector(a, 2.4, 1.05);\n`;
  const out = injectSceneSites(src, SCENE);
  expect(out).toMatch(
    /editVector\(a, 2\.4, 1\.05, \{ file: .+, at: \[\d+, \d+\] \}\)/,
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

test("injects helper files outside the catalog", () => {
  const helper = "apps/paper/src/scenes/plate-layout.ts";
  const src = `export function plateLayout() {
  const min = editPoint(-5.5, -3.2);
}
`;
  const out = injectSceneSites(src, helper);
  expect(out).toMatch(
    new RegExp(
      `editPoint\\(-5\\.5, -3\\.2, \\{ file: ${JSON.stringify(helper)}, at: \\[\\d+, \\d+\\] \\}\\)`,
    ),
  );
});
