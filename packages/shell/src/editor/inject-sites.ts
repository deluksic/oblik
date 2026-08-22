import * as ts from "typescript";

import { callSiteSpec, isSiteCall } from "./call-sites.ts";

function parse(source: string): ts.SourceFile {
  return ts.createSourceFile("scene.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function collectSiteCalls(sourceFile: ts.SourceFile): ts.CallExpression[] {
  const calls: ts.CallExpression[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      isSiteCall(node.expression.text)
    ) {
      calls.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return calls;
}

function isNumericDof(expr: ts.Expression | undefined): boolean {
  if (!expr) return false;
  if (ts.isNumericLiteral(expr)) return true;
  return (
    ts.isPrefixUnaryExpression(expr) &&
    expr.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(expr.operand)
  );
}

function trailingObject(call: ts.CallExpression): ts.ObjectLiteralExpression | undefined {
  const last = call.arguments[call.arguments.length - 1];
  if (last && ts.isObjectLiteralExpression(last)) return last;
  return undefined;
}

function propertyNamed(obj: ts.ObjectLiteralExpression, name: string): ts.ObjectLiteralElementLike | undefined {
  return obj.properties.find(
    (p) =>
      (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) &&
      ts.isIdentifier(p.name) &&
      p.name.text === name,
  );
}

function isFrozen(obj: ts.ObjectLiteralExpression): boolean {
  const p = propertyNamed(obj, "editable");
  if (!p || !ts.isPropertyAssignment(p)) return false;
  return p.initializer.kind === ts.SyntaxKind.FalseKeyword;
}

function dofEditable(name: string, args: readonly ts.Expression[]): boolean {
  const dof = callSiteSpec(name)?.dof;
  if (!dof || dof.length === 0) return false;
  return dof.every((i) => isNumericDof(args[i]));
}

function callEditable(call: ts.CallExpression): boolean {
  const name = (call.expression as ts.Identifier).text;
  const opts = trailingObject(call);
  if (opts && isFrozen(opts)) return false;
  const args = opts ? call.arguments.slice(0, -1) : call.arguments;
  return dofEditable(name, args);
}

function annotationsText(file: string, line: number, column: number, editable: boolean): string {
  return `__annotations__: { file: ${JSON.stringify(file)}, at: [${line}, ${column}], editable: ${editable} }`;
}

export type AnnotateResult = { code: string; warnings: string[] };

/**
 * Inject `__annotations__: { file, at, editable }` onto edit* / geom constructors
 * in compiled output. Source on disk is unchanged.
 */
export function annotateCallSites(source: string, file: string): AnnotateResult {
  const sf = parse(source);
  const calls = collectSiteCalls(sf);
  if (calls.length === 0) return { code: source, warnings: [] };
  const splices: { start: number; end: number; text: string }[] = [];
  const warnings: string[] = [];
  for (const call of calls) {
    const pos = sf.getLineAndCharacterOfPosition(call.getStart(sf));
    const line = pos.line + 1;
    const column = pos.character + 1;
    const editable = callEditable(call);
    const bag = annotationsText(file, line, column, editable);
    const last = trailingObject(call);
    if (last) {
      if (propertyNamed(last, "__annotations__")) {
        warnings.push(
          `${file}:${line}:${column} __annotations__ on disk was replaced by the call-site annotator`,
        );
      }
      const kept = last.properties.filter((p) => {
        const n =
          (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && ts.isIdentifier(p.name)
            ? p.name.text
            : "";
        return n !== "__annotations__";
      });
      const inner = kept.length ? `${kept.map((p) => p.getText(sf)).join(", ")}, ${bag}` : bag;
      splices.push({
        start: last.getStart(sf) + 1,
        end: last.getEnd() - 1,
        text: ` ${inner} `,
      });
    } else {
      const at = call.getEnd() - 1;
      splices.push({
        start: at,
        end: at,
        text: `, { ${bag} }`,
      });
    }
  }
  splices.sort((a, b) => b.start - a.start);
  let next = source;
  for (const s of splices) {
    next = next.slice(0, s.start) + s.text + next.slice(s.end);
  }
  return { code: next, warnings };
}

export function injectSceneSites(source: string, file: string): string {
  return annotateCallSites(source, file).code;
}
