import * as ts from "typescript";
import { expect, test } from "vitest";

import { isSiteCall } from "./call-sites";
import { findIdentifierCallAt } from "./patch-widget";
import { patchStyleAt } from "./patch-style";

function at(source: string, name: string): { line: number; column: number } {
  const sf = ts.createSourceFile("scene.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const calls: ts.CallExpression[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name) {
      calls.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  const call = calls[0];
  if (!call) throw new Error(`no ${name}() call`);
  const pos = sf.getLineAndCharacterOfPosition(call.getStart(sf));
  return { line: pos.line + 1, column: pos.character + 1 };
}

const lineStyle = { color: "#e8876a", width: 2, dash: "dashed" as const };
const pointStyle = { color: "#e8876a", size: 5 };

test("appends { style } when the call has no options bag", () => {
  const src = `segment(a, b);\n`;
  const loc = at(src, "segment");
  expect(isSiteCall("segment")).toBe(true);
  expect(
    findIdentifierCallAt(
      ts.createSourceFile("s.ts", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS),
      loc.line,
      loc.column,
      isSiteCall,
    ),
  ).toBeTruthy();
  expect(patchStyleAt(src, loc.line, loc.column, { line: lineStyle })).toBe(
    `segment(a, b, { style: { line: { color: "#e8876a", width: 2, dash: "dashed" } } });\n`,
  );
});

test("writes only the fields that were set", () => {
  const src = `segment(a, b);\n`;
  const loc = at(src, "segment");
  expect(patchStyleAt(src, loc.line, loc.column, { line: { dash: "dashed" } })).toBe(
    `segment(a, b, { style: { line: { dash: "dashed" } } });\n`,
  );
});

test("adds style to an existing options bag and keeps other keys", () => {
  const src = `offsetLine(ground, 1.8, { mirror: true });\n`;
  const loc = at(src, "offsetLine");
  expect(patchStyleAt(src, loc.line, loc.column, { line: lineStyle })).toBe(
    `offsetLine(ground, 1.8, { mirror: true, style: { line: { color: "#e8876a", width: 2, dash: "dashed" } } });\n`,
  );
});

test("replaces an existing style object", () => {
  const src = `circle(c, 40, { style: { line: { color: "#fff", width: 1, dash: "solid" } } });\n`;
  const loc = at(src, "circle");
  expect(patchStyleAt(src, loc.line, loc.column, { line: { dash: "dotted" } })).toBe(
    `circle(c, 40, { style: { line: { dash: "dotted" } } });\n`,
  );
});

test("removing style drops an empty options bag", () => {
  const src = `segment(a, b, { style: { line: { color: "#e8876a", width: 2, dash: "dashed" } } });\n`;
  const loc = at(src, "segment");
  expect(patchStyleAt(src, loc.line, loc.column, null)).toBe(`segment(a, b);\n`);
});

test("removing style keeps { mirror }", () => {
  const src = `offsetLine(ground, 1.8, { mirror: true, style: { line: { color: "#e8876a", width: 2, dash: "dashed" } } });\n`;
  const loc = at(src, "offsetLine");
  expect(patchStyleAt(src, loc.line, loc.column, null)).toBe(`offsetLine(ground, 1.8, { mirror: true });\n`);
});

test("point style writes only the point channel fields that were set", () => {
  const src = `point(1, 2);\n`;
  const loc = at(src, "point");
  expect(patchStyleAt(src, loc.line, loc.column, { point: pointStyle })).toBe(
    `point(1, 2, { style: { point: { color: "#e8876a", size: 5 } } });\n`,
  );
  expect(patchStyleAt(src, loc.line, loc.column, { point: { size: 6 } })).toBe(
    `point(1, 2, { style: { point: { size: 6 } } });\n`,
  );
});
