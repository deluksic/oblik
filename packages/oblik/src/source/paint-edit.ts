import * as ts from "typescript";

import { trailingId } from "./analyze";
import { printExpr, type Expr } from "./expr";
import { ensureNamedImport } from "./insert";

function parse(source: string): ts.SourceFile {
  return ts.createSourceFile("scene.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function paintCallWithId(sf: ts.SourceFile, id: string): ts.CallExpression | undefined {
  let found: ts.CallExpression | undefined;
  const visit = (node: ts.Node) => {
    if (found) return;
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "paint" &&
      trailingId(node).id === id
    ) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

function statementOf(node: ts.Node): ts.Statement | undefined {
  let n: ts.Node | undefined = node;
  while (n && !ts.isSourceFile(n)) {
    if (ts.isStatement(n) && n.parent && (ts.isBlock(n.parent) || ts.isSourceFile(n.parent))) return n;
    n = n.parent;
  }
  return undefined;
}

function callees(expr: Expr): string[] {
  if (expr.kind === "call") return [expr.name, ...expr.args.flatMap(callees)];
  if (expr.kind === "array") return expr.items.flatMap(callees);
  if (expr.kind === "neg") return callees(expr.expr);
  if (expr.kind === "props") return Object.values(expr.props).flatMap(callees);
  if (expr.kind === "member") return callees(expr.object);
  return [];
}

/** Replace the look argument of `paint(geom, look, id)`. */
export function patchPaintStyle(source: string, id: string, look: Expr): string {
  const withImport = ensureNamedImport(source, "oblik", ["paint", ...callees(look)]);
  const sf = parse(withImport);
  const call = paintCallWithId(sf, id);
  if (!call) throw new Error(`no paint(..., "${id}")`);
  const { args } = trailingId(call);
  const lookArg = args[1];
  if (!lookArg) throw new Error(`paint("${id}") has no look argument`);
  return withImport.slice(0, lookArg.getStart(sf)) + printExpr(look) + withImport.slice(lookArg.getEnd());
}

/** Remove the statement that owns `paint(..., id)`. Geom stays. */
export function removePaintCall(source: string, id: string): string {
  const sf = parse(source);
  const call = paintCallWithId(sf, id);
  if (!call) throw new Error(`no paint(..., "${id}")`);
  const stmt = statementOf(call);
  if (!stmt) throw new Error(`paint("${id}") is not a statement`);
  let start = stmt.getFullStart();
  const end = stmt.getEnd();
  if (start > 0 && source[start] !== "\n" && source.slice(start, stmt.getStart(sf)).includes("\n")) {
    // keep getFullStart — leading trivia already includes the newline after the previous stmt
  }
  let next = source.slice(0, start) + source.slice(end);
  if (next.includes("\n\n\n")) next = next.replace(/\n{3,}/g, "\n\n");
  return next;
}
