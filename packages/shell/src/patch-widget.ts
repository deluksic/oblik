import * as ts from "typescript";
import { EDIT_NAMES } from "./edit-names.ts";

export function formatNum(n: number): string {
  const q = Math.round(n * 100) / 100;
  if (Object.is(q, -0)) return "0";
  return String(q);
}

function parse(source: string): ts.SourceFile {
  return ts.createSourceFile(
    "scene.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
}

export function collectEditCalls(sourceFile: ts.SourceFile): ts.CallExpression[] {
  const calls: ts.CallExpression[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      EDIT_NAMES.has(node.expression.text)
    ) {
      calls.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return calls;
}

export function findEditCallAt(
  sourceFile: ts.SourceFile,
  line: number,
  column: number,
): ts.CallExpression | null {
  const located = collectEditCalls(sourceFile).map((call) => {
    const pos = sourceFile.getLineAndCharacterOfPosition(
      call.getStart(sourceFile),
    );
    return { call, line: pos.line + 1, column: pos.character + 1 };
  });
  const exact = located.find((x) => x.line === line && x.column === column);
  if (exact) return exact.call;
  const onLine = located.filter((x) => x.line === line);
  if (onLine.length === 1) return onLine[0]!.call;
  return null;
}

function numericSpan(
  sourceFile: ts.SourceFile,
  expr: ts.Expression,
): { start: number; end: number } | null {
  if (ts.isNumericLiteral(expr)) {
    return { start: expr.getStart(sourceFile), end: expr.getEnd() };
  }
  if (
    ts.isPrefixUnaryExpression(expr) &&
    expr.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(expr.operand)
  ) {
    return { start: expr.getStart(sourceFile), end: expr.getEnd() };
  }
  return null;
}

function patchArgs(
  sourceFile: ts.SourceFile,
  args: readonly ts.Expression[],
  start: number,
  needed: number,
  values: number[],
  name: string,
): { start: number; end: number; text: string }[] {
  if (args.length < start + needed) {
    throw new Error(`${name} expects ${needed} numeric arguments`);
  }
  if (values.length < needed) {
    throw new Error(`${name} write needs ${needed} values`);
  }
  const spans: { start: number; end: number; text: string }[] = [];
  for (let i = 0; i < needed; i++) {
    const arg = args[start + i];
    const v = values[i];
    if (!arg || v === undefined) throw new Error(`${name} missing argument ${i}`);
    const span = numericSpan(sourceFile, arg);
    if (!span) throw new Error(`${name} args are not numeric literals`);
    spans.push({ ...span, text: formatNum(v) });
  }
  return spans;
}

/** Rewrite numeric literals on the edit* whose CallExpression starts at line:column. */
export function patchWidgetAt(
  source: string,
  line: number,
  column: number,
  values: number[],
): string {
  const sourceFile = parse(source);
  const call = findEditCallAt(sourceFile, line, column);
  if (!call) {
    throw new Error(`no edit* at ${line}:${column}`);
  }

  const name = (call.expression as ts.Identifier).text;
  const args = call.arguments;
  let spans: { start: number; end: number; text: string }[];

  if (name === "editNumber") {
    spans = patchArgs(sourceFile, args, 0, 1, values, name);
  } else if (name === "editAngle") {
    spans = patchArgs(sourceFile, args, 1, 1, values, name);
  } else if (name === "editPoint") {
    spans = patchArgs(sourceFile, args, 0, 2, values, name);
  } else if (name === "editPoint3") {
    spans = patchArgs(sourceFile, args, 0, 3, values, name);
  } else if (name === "editVector") {
    spans = patchArgs(sourceFile, args, 1, 2, values, name);
  } else if (name === "editPointOnLine") {
    const arg = args[2];
    if (!arg) throw new Error(`${name} missing s argument`);
    const span = numericSpan(sourceFile, arg);
    if (!span) throw new Error(`${name} s is not a numeric literal`);
    if (values[0] === undefined) throw new Error(`${name} write needs a value`);
    spans = [{ ...span, text: formatNum(values[0]) }];
  } else {
    const lastNumeric = name === "editDistanceToPoint" ||
      name === "editDistance3" ||
      name === "editPointOnSegment" ||
      name === "editPointOnSegment3"
      ? args[1]
      : args[args.length - 1];
    if (!lastNumeric) throw new Error(`${name} missing argument`);
    const span = numericSpan(sourceFile, lastNumeric);
    if (!span) throw new Error(`${name} last arg is not a numeric literal`);
    if (values[0] === undefined) throw new Error(`${name} write needs a value`);
    spans = [{ ...span, text: formatNum(values[0]) }];
  }

  spans.sort((a, b) => b.start - a.start);
  let next = source;
  for (const s of spans) {
    next = next.slice(0, s.start) + s.text + next.slice(s.end);
  }
  return next;
}
