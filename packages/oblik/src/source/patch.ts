import MagicString from "magic-string";
import * as ts from "typescript";

import { siteSpecs, trailingId } from "./analyze";


const { round } = Math;
function parse(source: string): ts.SourceFile {
  return ts.createSourceFile("scene.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function isNumeric(expr: ts.Expression | undefined): boolean {
  if (!expr) return false;
  if (ts.isNumericLiteral(expr)) return true;
  return (
    ts.isPrefixUnaryExpression(expr) &&
    expr.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(expr.operand)
  );
}

export function formatNum(n: number): string {
  const q = round(n * 100) / 100;
  if (Object.is(q, -0)) return "0";
  return String(q);
}

export function patchLiterals(source: string, id: string, values: number[]): string | null {
  const specs = siteSpecs();
  const sf = parse(source);
  let target: ts.CallExpression | undefined;
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      specs.has(node.expression.text)
    ) {
      const trail = trailingId(node);
      if (trail.id === id) target = node;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (!target || !ts.isIdentifier(target.expression)) return null;
  const spec = specs.get(target.expression.text);
  if (!spec || spec.dof.length === 0) return null;
  const { args } = trailingId(target);
  if (values.length !== spec.dof.length) return null;
  const ms = new MagicString(source);
  for (let i = 0; i < spec.dof.length; i++) {
    const arg = args[spec.dof[i]!];
    if (!arg || !isNumeric(arg)) return null;
    ms.overwrite(arg.getStart(sf), arg.getEnd(), formatNum(values[i]!));
  }
  return ms.toString();
}
