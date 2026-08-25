import * as ts from "typescript";

import { constructors } from "../eval/constructors";
import { siteOf, type SiteFn, type SiteSpec } from "../eval/site";

export type Annotation = {
  id: string;
  editable: boolean;
  bind?: string;
  file: string;
  line: number;
  column: number;
  literals?: number[];
};

export function siteSpecs(): Map<string, SiteSpec> {
  const out = new Map<string, SiteSpec>();
  for (const [name, fn] of Object.entries(constructors)) {
    const spec = siteOf(fn as SiteFn);
    if (spec) out.set(name, spec);
  }
  return out;
}

function parse(source: string, file = "scene.ts"): ts.SourceFile {
  return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
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

function numericValue(expr: ts.Expression): number | undefined {
  if (ts.isNumericLiteral(expr)) return Number(expr.text);
  if (
    ts.isPrefixUnaryExpression(expr) &&
    expr.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(expr.operand)
  ) {
    return -Number(expr.operand.text);
  }
  return undefined;
}

export function trailingId(call: ts.CallExpression): { id: string; args: readonly ts.Expression[] } {
  if (call.arguments.length === 0) return { id: "", args: call.arguments };
  const last = call.arguments[call.arguments.length - 1];
  if (last && ts.isStringLiteral(last)) {
    return { id: last.text, args: call.arguments.slice(0, -1) };
  }
  return { id: "", args: call.arguments };
}

function bindName(call: ts.CallExpression): string | undefined {
  let n: ts.Node = call.parent;
  while (ts.isAsExpression(n) || ts.isParenthesizedExpression(n) || ts.isSatisfiesExpression(n)) {
    n = n.parent;
  }
  if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name)) return n.name.text;
  return undefined;
}

/** Every constructor call with a trailing id — including collisions the Map would drop. */
export function listAnnotationSites(source: string, file = "scene.ts"): Annotation[] {
  const specs = siteSpecs();
  const sf = parse(source, file);
  const out: Annotation[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const spec = specs.get(node.expression.text);
      if (spec) {
        const { id, args } = trailingId(node);
        if (id) {
          const pos = sf.getLineAndCharacterOfPosition(node.getStart(sf));
          const editable = spec.dof.length > 0 && spec.dof.every((i) => isNumeric(args[i]));
          const literals = editable
            ? spec.dof.map((i) => numericValue(args[i]!)).filter((n): n is number => n != null)
            : undefined;
          const bind = bindName(node);
          out.push({
            id,
            editable,
            bind,
            file,
            line: pos.line + 1,
            column: pos.character + 1,
            ...(literals && literals.length === spec.dof.length ? { literals } : {}),
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

export function analyze(source: string, file = "scene.ts"): Map<string, Annotation> {
  const out = new Map<string, Annotation>();
  for (const site of listAnnotationSites(source, file)) out.set(site.id, site);
  return out;
}