import MagicString from "magic-string";
import * as ts from "typescript";

import { siteSpecs, trailingId } from "./analyze";
import { printExpr, exprRefs, type Expr } from "./expr";
import { hoistIntersections, takeBind } from "./hoist";
import { freshSiteId } from "./stamp";

export type Insert = {
  file?: string;
  from: string;
  bind?: string;
  args: Expr[];
  id?: string;
  patchVertex?: { id: string; index: number };
};

function parse(source: string): ts.SourceFile {
  return ts.createSourceFile("scene.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function findBuildBody(sf: ts.SourceFile): ts.Block | null {
  let body: ts.Block | null = null;
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "defineScene" &&
      node.arguments[0] &&
      ts.isObjectLiteralExpression(node.arguments[0])
    ) {
      for (const prop of node.arguments[0].properties) {
        if (ts.isMethodDeclaration(prop) && ident(prop.name) === "build" && prop.body) {
          body = prop.body;
          return;
        }
        if (ts.isPropertyAssignment(prop) && ident(prop.name) === "build") {
          const init = prop.initializer;
          if ((ts.isFunctionExpression(init) || ts.isArrowFunction(init)) && init.body && ts.isBlock(init.body)) {
            body = init.body;
            return;
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return body;
}

function ident(name: ts.PropertyName | ts.BindingName | undefined): string | undefined {
  if (!name) return undefined;
  if (ts.isIdentifier(name)) return name.text;
  if (ts.isStringLiteral(name)) return name.text;
  return undefined;
}

function usedIdentifiers(sf: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node)) names.add(node.text);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return names;
}

export function freshBind(source: string, from: string, requested?: string): string {
  return takeBind(usedIdentifiers(parse(source)), from, requested);
}

export function ensureNamedImport(source: string, moduleName: string, names: readonly string[]): string {
  const sf = parse(source);
  let importDecl: ts.ImportDeclaration | undefined;
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;
    if (!ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    if (stmt.moduleSpecifier.text !== moduleName) continue;
    importDecl = stmt;
    break;
  }
  if (!importDecl) {
    return `import { ${names.join(", ")} } from ${JSON.stringify(moduleName)};\n${source}`;
  }
  const named = importDecl.importClause?.namedBindings;
  if (!named || !ts.isNamedImports(named)) {
    throw new Error(`existing import from ${moduleName} is not named`);
  }
  const have = new Set(named.elements.map((el) => (el.propertyName ?? el.name).text));
  const missing = names.filter((n) => !have.has(n));
  if (missing.length === 0) return source;
  const last = named.elements[named.elements.length - 1];
  if (!last) throw new Error(`empty named import from ${moduleName}`);
  return source.slice(0, last.getEnd()) + `, ${missing.join(", ")}` + source.slice(last.getEnd());
}

function indentAt(source: string, pos: number): string {
  const lineStart = source.lastIndexOf("\n", pos - 1) + 1;
  const m = source.slice(lineStart, pos).match(/^[ \t]*/);
  return m?.[0] ?? "    ";
}

function callees(expr: Expr): string[] {
  if (expr.kind === "call") return [expr.name, ...expr.args.flatMap(callees)];
  if (expr.kind === "array") return expr.items.flatMap(callees);
  if (expr.kind === "neg") return callees(expr.expr);
  if (expr.kind === "props") return Object.values(expr.props).flatMap(callees);
  if (expr.kind === "member") return callees(expr.object);
  return [];
}

function addBindingName(name: ts.BindingName, into: Set<string>) {
  if (ts.isIdentifier(name)) {
    into.add(name.text);
    return;
  }
  for (const el of name.elements) {
    if (ts.isBindingElement(el)) addBindingName(el.name, into);
  }
}

/** Imports plus bindings declared directly in `build()` — not locals inside helpers. */
export function namesInBuildScope(source: string): Set<string> {
  const sf = parse(source);
  const names = new Set<string>();
  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt)) {
      const clause = stmt.importClause;
      if (!clause) continue;
      if (clause.name) names.add(clause.name.text);
      const nb = clause.namedBindings;
      if (nb && ts.isNamespaceImport(nb)) names.add(nb.name.text);
      if (nb && ts.isNamedImports(nb)) {
        for (const el of nb.elements) names.add(el.name.text);
      }
    }
    if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) addBindingName(d.name, names);
    }
    if (ts.isFunctionDeclaration(stmt) && stmt.name) names.add(stmt.name.text);
  }
  const body = findBuildBody(sf);
  if (!body) return names;
  for (const stmt of body.statements) {
    if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) addBindingName(d.name, names);
    }
    if (ts.isFunctionDeclaration(stmt) && stmt.name) names.add(stmt.name.text);
  }
  return names;
}

function isFilletCall(node: ts.Expression): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "fillet" &&
    node.arguments.length >= 2
  );
}

function findProfileCall(sf: ts.SourceFile, id: string): ts.CallExpression | undefined {
  let target: ts.CallExpression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "profile") {
      if (trailingId(node).id === id) target = node;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return target;
}

function isZeroNum(expr: Expr): boolean {
  return expr.kind === "num" && expr.value === 0;
}

function patchProfileVertex(source: string, job: Insert): string {
  const patch = job.patchVertex;
  if (!patch) throw new Error("missing patchVertex");
  const radius = job.args[0];
  if (!radius) throw new Error("fillet radius is required");
  const names = isZeroNum(radius) ? callees(radius) : ["fillet", ...callees(radius)];
  let next = names.length > 0 ? ensureNamedImport(source, "oblik", names) : source;
  const sf = parse(next);
  const call = findProfileCall(sf, patch.id);
  if (!call) throw new Error(`no profile with id ${patch.id}`);
  const { args } = trailingId(call);
  const arr = args[0];
  if (!arr || !ts.isArrayLiteralExpression(arr)) {
    throw new Error("Fillet needs the profile cycle as an array literal.");
  }
  const elemIndex = 2 * patch.index;
  const elem = arr.elements[elemIndex];
  if (!elem || ts.isSpreadElement(elem) || ts.isOmittedExpression(elem)) {
    throw new Error(`vertex index ${patch.index} is out of range`);
  }
  const ms = new MagicString(next);
  const rText = printExpr(radius);
  if (isFilletCall(elem)) {
    if (isZeroNum(radius)) {
      ms.overwrite(elem.getStart(sf), elem.getEnd(), elem.arguments[0]!.getText(sf));
    } else {
      const arg = elem.arguments[1]!;
      ms.overwrite(arg.getStart(sf), arg.getEnd(), rText);
    }
  } else if (isZeroNum(radius)) {
    return next;
  } else {
    ms.overwrite(elem.getStart(sf), elem.getEnd(), `fillet(${elem.getText(sf)}, ${rText})`);
  }
  return ms.toString();
}

export function insertCall(source: string, job: Insert, nextId: () => string = freshSiteId): string {
  if (job.patchVertex) return patchProfileVertex(source, job);
  const specs = siteSpecs();
  if (!specs.has(job.from)) throw new Error(`unknown constructor ${job.from}`);
  const used = usedIdentifiers(parse(source));
  const { exprs: args, hoists } = hoistIntersections(job.args, used);
  for (const h of hoists) {
    if (!specs.has(h.from)) throw new Error(`unknown constructor ${h.from}`);
  }
  const bind = takeBind(used, job.from, job.bind);
  const statements = [
    ...hoists.map((h) => ({ bind: h.bind, from: h.from, args: h.args, id: nextId() })),
    { bind, from: job.from, args, id: job.id ?? nextId() },
  ];
  const introduced = new Set(statements.map((s) => s.bind));
  const scope = namesInBuildScope(source);
  const missing = [
    ...new Set(statements.flatMap((s) => s.args.flatMap(exprRefs)).filter((n) => !scope.has(n) && !introduced.has(n))),
  ];
  if (missing.length > 0) {
    const who = missing.join(", ");
    const verb = missing.length === 1 ? "is" : "are";
    throw new Error(
      `${who} ${verb} not in build() — geometry constructed in a helper cannot be inserted yet.`,
    );
  }
  const names = [
    ...new Set(statements.flatMap((s) => [s.from, ...s.args.flatMap(callees)])),
  ];
  let next = ensureNamedImport(source, "oblik", names);
  const sf = parse(next);
  const body = findBuildBody(sf);
  if (!body) throw new Error("no defineScene({ build() { … } })");
  const stmts = body.statements;
  const last = stmts[stmts.length - 1];
  const indent = last ? indentAt(next, last.getStart(sf)) : "    ";
  const chunk = statements
    .map((s) => `${indent}const ${s.bind} = ${s.from}(${s.args.map(printExpr).join(", ")}, "${s.id}");\n`)
    .join("");
  if (last && ts.isReturnStatement(last)) {
    const lineStart = next.lastIndexOf("\n", last.getStart(sf) - 1) + 1;
    return next.slice(0, lineStart) + chunk + next.slice(lineStart);
  }
  const close = body.getEnd() - 1;
  const before = next.slice(0, close);
  const prefix = before.endsWith("\n") ? "" : "\n";
  return before + prefix + chunk + next.slice(close);
}
