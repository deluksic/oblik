import MagicString from "magic-string";
import * as ts from "typescript";

import { formatNum } from "./patch";

export type FrameValues = { x: number; y: number; width: number; height: number };

const FRAME_KEYS = ["width", "height", "x", "y"] as const;

function parse(source: string): ts.SourceFile {
  return ts.createSourceFile("scene.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

/** The object literal of `export default <obj>` or `export default defineScene(<obj>)`. */
function defaultExportObject(sf: ts.SourceFile): ts.ObjectLiteralExpression | undefined {
  for (const st of sf.statements) {
    if (!ts.isExportAssignment(st) || st.isExportEquals) continue;
    let expr: ts.Expression = st.expression;
    if (ts.isCallExpression(expr) && expr.arguments.length > 0) expr = expr.arguments[0]!;
    if (ts.isObjectLiteralExpression(expr)) return expr;
  }
  return undefined;
}

function propName(p: ts.ObjectLiteralElementLike): string | undefined {
  const name = p.name;
  if (name && (ts.isIdentifier(name) || ts.isStringLiteral(name))) return name.text;
  return undefined;
}

function findProp(
  obj: ts.ObjectLiteralExpression,
  name: string,
): ts.PropertyAssignment | undefined {
  for (const p of obj.properties) {
    if (ts.isPropertyAssignment(p) && propName(p) === name) return p;
  }
  return undefined;
}

function isNumericInit(expr: ts.Expression): boolean {
  if (ts.isNumericLiteral(expr)) return true;
  return (
    ts.isPrefixUnaryExpression(expr) &&
    expr.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(expr.operand)
  );
}

/**
 * Rewrite the `frame` object literal of a figure scene's default export,
 * overwriting existing numeric `x`/`y`/`width`/`height` and inserting any that
 * are missing. Returns undefined when there is no patchable `frame` literal.
 */
export function patchFrame(source: string, values: FrameValues): string | undefined {
  const sf = parse(source);
  const obj = defaultExportObject(sf);
  if (!obj) return undefined;
  const frameProp = findProp(obj, "frame");
  if (!frameProp || !ts.isObjectLiteralExpression(frameProp.initializer)) return undefined;
  const frame = frameProp.initializer;

  const ms = new MagicString(source);
  const missing: string[] = [];
  for (const key of FRAME_KEYS) {
    const prop = findProp(frame, key);
    const text = formatNum(values[key]);
    if (!prop) {
      missing.push(`${key}: ${text}`);
      continue;
    }
    if (!isNumericInit(prop.initializer)) return undefined;
    ms.overwrite(prop.initializer.getStart(sf), prop.initializer.getEnd(), text);
  }

  if (missing.length > 0) {
    const props = frame.properties;
    const last = props[props.length - 1];
    if (last) ms.appendLeft(last.getEnd(), `, ${missing.join(", ")}`);
    else ms.appendLeft(frame.getStart(sf) + 1, ` ${missing.join(", ")} `);
  }

  return ms.toString();
}
