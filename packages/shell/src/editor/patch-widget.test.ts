import * as ts from "typescript";
import { expect, test } from "vitest";

import { insertEditors } from "./insert-editor";
import { collectEditCalls, patchWidgetAt } from "./patch-widget";

function at(source: string, i = 0): { line: number; column: number } {
  const sf = ts.createSourceFile(
    "scene.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const call = collectEditCalls(sf)[i];
  if (!call) throw new Error(`no writable call at ${i}`);
  const pos = sf.getLineAndCharacterOfPosition(call.getStart(sf));
  return { line: pos.line + 1, column: pos.character + 1 };
}

const loop = `import { circle } from "@design-scenes/geom";

export function scene() {
  const o = point(0, 0);
  for (let i = 0; i < 5; i++) {
    circle(o, 0.4);
  }
  return circle(o, 1);
}
`;

test("loop of five distances is one write target", () => {
  const loc = at(loop, 1);
  const next = patchWidgetAt(loop, loc.line, loc.column, [0.9]);
  expect(next).toMatch(/circle\(o, 0\.9\)/);
  expect(next).not.toMatch(/0\.4/);
  expect(
    collectEditCalls(
      ts.createSourceFile("s.ts", next, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS),
    ).length,
  ).toBe(3);
});

test("two points in different functions patch independently", () => {
  const src = `export function left() {
  const a = point(1, 2);
}
export function right() {
  const b = point(3, 4);
}
`;
  const a = at(src, 0);
  const b = at(src, 1);
  const afterA = patchWidgetAt(src, a.line, a.column, [9, 8]);
  expect(afterA).toMatch(/point\(9, 8\)/);
  expect(afterA).toMatch(/point\(3, 4\)/);
  const afterB = patchWidgetAt(afterA, b.line, b.column, [7, 6]);
  expect(afterB).toMatch(/point\(9, 8\)/);
  expect(afterB).toMatch(/point\(7, 6\)/);
});

test("same line in two files patches independently", () => {
  const fileA = `const p = point(1, 2);\n`;
  const fileB = `const q = point(3, 4);\n`;
  const locA = at(fileA, 0);
  const locB = at(fileB, 0);
  expect(locA.line).toBe(locB.line);
  const nextA = patchWidgetAt(fileA, locA.line, locA.column, [5, 6]);
  const nextB = patchWidgetAt(fileB, locB.line, locB.column, [7, 8]);
  expect(nextA).toMatch(/point\(5, 6\)/);
  expect(nextB).toMatch(/point\(7, 8\)/);
  expect(fileB.includes("5, 6")).toBe(false);
});

test("inserting a point elsewhere does not rewrite the loop literal", () => {
  const next = insertEditors(loop, [{ kind: "point", x: 1, y: 2 }]);
  expect(next).toMatch(/circle\(o, 0\.4\)/);
  expect(next).toMatch(/const p = point\(1, 2\)/);
});

test("finds the call when column drifted but the line is unique", () => {
  const src = `  const a = point(1, 2);\n`;
  const loc = at(src, 0);
  const next = patchWidgetAt(src, loc.line, loc.column + 3, [9, 8]);
  expect(next).toMatch(/point\(9, 8\)/);
});

test("vector patches dx, dy and leaves origin", () => {
  const src = `const a = point(-2.2, 0.15);
const d = vector(a, 2.4, 1.05);
`;
  const loc = at(src, 1);
  const next = patchWidgetAt(src, loc.line, loc.column, [3.1, -0.5]);
  expect(next).toMatch(/vector\(a, 3\.1, -0\.5\)/);
  expect(next).toMatch(/point\(-2\.2, 0\.15\)/);
});

test("pointOnLine patches s (third arg)", () => {
  const src = `const p = pointOnLine({ x: 0, y: 0 }, { x: 1, y: 1 }, 0.54, { min: 0 });
`;
  const loc = at(src, 0);
  const next = patchWidgetAt(src, loc.line, loc.column, [0.72]);
  expect(next).toMatch(
    /pointOnLine\(\{ x: 0, y: 0 \}, \{ x: 1, y: 1 \}, 0\.72, \{ min: 0 \}\)/,
  );
});

test("pointOnSegment patches t", () => {
  const src = `const p = pointOnSegment(span, 0.52);
`;
  const loc = at(src, 0);
  const next = patchWidgetAt(src, loc.line, loc.column, [0.61]);
  expect(next).toMatch(/pointOnSegment\(span, 0\.61\)/);
});

test("point and circle constructor literals patch", () => {
  const src = `const A = point(0, 0);
const reach = circle(A, 2.5);
`;
  const locA = at(src, 0);
  const nextA = patchWidgetAt(src, locA.line, locA.column, [1.2, 0.4]);
  expect(nextA).toMatch(/point\(1\.2, 0\.4\)/);
  const locC = at(nextA, 1);
  const nextC = patchWidgetAt(nextA, locC.line, locC.column, [3.1]);
  expect(nextC).toMatch(/circle\(A, 3\.1\)/);
});

test("offsetLine and slider patch the length literal", () => {
  const src = `const shelf = offsetLine(ground, 1.8);
const r = slider(2.4);
`;
  expect(patchWidgetAt(src, at(src, 0).line, at(src, 0).column, [2])).toMatch(/offsetLine\(ground, 2\)/);
  expect(patchWidgetAt(src, at(src, 1).line, at(src, 1).column, [0.5])).toMatch(/slider\(0\.5\)/);
});

test("slider with options still patches the value literal", () => {
  const src = `const reach = slider(1.8, { label: "reach", min: 0, max: 4 });\n`;
  expect(patchWidgetAt(src, at(src).line, at(src).column, [2.2])).toMatch(
    /slider\(2\.2, \{ label: "reach", min: 0, max: 4 \}\)/,
  );
});
