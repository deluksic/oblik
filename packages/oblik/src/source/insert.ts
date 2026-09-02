import MagicString from "magic-string";
import * as ts from "typescript";

import { siteSpecs, trailingId } from "./analyze";
import { printExpr, exprRefs, type Expr } from "./expr";
import { hoistIntersections, takeBind } from "./hoist";
import { analyzeMentions, fnNamed, insertPointNames } from "./mention";
import { freshSiteId } from "./stamp";

export type Insert = {
  file?: string;
  /** Function to insert into. Default `"build"` is the evaluate entry name, not a special kind of function. */
  dest?: string;
  from: string;
  bind?: string;
  args: Expr[];
  id?: string;
  patchVertex?: { id: string; index: number };
};

/** `paint` is a tape effect. Nothing refers to the value, so it is not a `const`. */
const EFFECT_CTORS = new Set(["paint"]);

function parse(source: string): ts.SourceFile {
  return ts.createSourceFile("scene.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function isFnLike(
  n: ts.Node,
): n is ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration {
  return (
    ts.isFunctionDeclaration(n) ||
    ts.isFunctionExpression(n) ||
    ts.isArrowFunction(n) ||
    ts.isMethodDeclaration(n)
  );
}

function fnLabel(
  node: ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration,
): string | undefined {
  if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.name)
    return ident(node.name);
  const parent = node.parent;
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
  if (ts.isPropertyAssignment(parent)) return ident(parent.name);
  return undefined;
}

function fnBlock(
  node: ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration,
): ts.Block | null {
  if (node.body && ts.isBlock(node.body)) return node.body;
  return null;
}

function findNamedFnBody(sf: ts.SourceFile, name: string): ts.Block | null {
  let body: ts.Block | null = null;
  const visit = (node: ts.Node) => {
    if (body) return;
    if (isFnLike(node) && fnLabel(node) === name) {
      const block = fnBlock(node);
      if (block) {
        body = block;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return body;
}

function findFnBody(sf: ts.SourceFile, dest?: string): ts.Block | null {
  return findNamedFnBody(sf, dest?.trim() || "build");
}

function usedInBody(body: ts.Block): Set<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node)) names.add(node.text);
    ts.forEachChild(node, visit);
  };
  visit(body);
  return names;
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

export function ensureNamedImport(
  source: string,
  moduleName: string,
  names: readonly string[],
): string {
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

function fileScopeNames(sf: ts.SourceFile): Set<string> {
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
  return names;
}

/** File imports/top-level names plus insert-point names in `dest` (params, consts, closures). */
export function namesInFunctionScope(source: string, dest?: string): Set<string> {
  const names = fileScopeNames(parse(source));
  const fn = fnNamed(analyzeMentions(source, "scene.ts"), dest?.trim() || "build");
  if (fn) for (const n of insertPointNames(fn)) names.add(n);
  return names;
}

/** @deprecated Same as `namesInFunctionScope`. */
export function namesInBuildScope(source: string, dest?: string): Set<string> {
  return namesInFunctionScope(source, dest);
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
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "region"
    ) {
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
  if (!call) throw new Error(`no region with id ${patch.id}`);
  const { args } = trailingId(call);
  const arr = args[0];
  if (!arr || !ts.isArrayLiteralExpression(arr)) {
    throw new Error("Fillet needs the region cycle as an array literal.");
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

const BIND_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

function unwrapExpr(expr: ts.Expression): ts.Expression {
  let e = expr;
  while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e)) {
    e = e.expression;
  }
  return e;
}

function objectHasField(obj: ts.ObjectLiteralExpression, bind: string): boolean {
  for (const p of obj.properties) {
    if (ts.isShorthandPropertyAssignment(p) && p.name.text === bind) return true;
    if (ts.isPropertyAssignment(p) && ident(p.name) === bind) return true;
  }
  return false;
}

function insertObjectField(
  source: string,
  sf: ts.SourceFile,
  obj: ts.ObjectLiteralExpression,
  bind: string,
): string {
  const props = obj.properties;
  if (props.length === 0) {
    return source.slice(0, obj.getStart(sf)) + `{ ${bind} }` + source.slice(obj.getEnd());
  }
  const last = props[props.length - 1]!;
  const afterLast = last.getEnd();
  const close = obj.getEnd() - 1;
  const gap = source.slice(afterLast, close);
  const multiline = source.slice(obj.getStart(sf), obj.getEnd()).includes("\n");
  const hasTrailingComma = gap.includes(",");
  if (!multiline) {
    if (hasTrailingComma) return source.slice(0, close) + ` ${bind}` + source.slice(close);
    return source.slice(0, afterLast) + `, ${bind}` + source.slice(afterLast);
  }
  const indent = indentAt(source, last.getStart(sf));
  if (hasTrailingComma) {
    const commaAt = afterLast + gap.indexOf(",");
    return source.slice(0, commaAt + 1) + `\n${indent}${bind},` + source.slice(commaAt + 1);
  }
  return source.slice(0, afterLast) + `,\n${indent}${bind}` + source.slice(afterLast);
}

/** Add `bind` as a shorthand field on `dest`'s object-literal return. Does not wrap a single-value return. */
export function exposeReturnBag(source: string, dest: string, bind: string): string {
  const name = dest.trim();
  if (!BIND_IDENT.test(bind)) throw new Error("bind must be an identifier");
  if (!name) throw new Error("no function to add a return bag field to");
  const sf = parse(source);
  const body = findFnBody(sf, name);
  if (!body) throw new Error(`no function ${name}() with a block body`);
  if (!namesInFunctionScope(source, name).has(bind)) {
    throw new Error(`${bind} is not in ${name}() — this scope cannot refer to ${bind}.`);
  }
  let ret: ts.ReturnStatement | undefined;
  for (let i = body.statements.length - 1; i >= 0; i--) {
    const s = body.statements[i];
    if (s && ts.isReturnStatement(s)) {
      ret = s;
      break;
    }
  }
  if (!ret) {
    const indent = indentAt(source, body.statements[0]?.getStart(sf) ?? body.getStart(sf) + 1);
    const close = body.getEnd() - 1;
    const before = source.slice(0, close);
    const prefix = before.endsWith("\n") ? "" : "\n";
    return `${before}${prefix}${indent}return { ${bind} };\n${source.slice(close)}`;
  }
  if (!ret.expression) {
    return `${source.slice(0, ret.getStart(sf))}return { ${bind} };${source.slice(ret.getEnd())}`;
  }
  const expr = unwrapExpr(ret.expression);
  if (!ts.isObjectLiteralExpression(expr)) {
    throw new Error(
      "This function returns a single value, so it has no return bag to add a field to. Change the return to an object literal first — oblik will not wrap it.",
    );
  }
  if (objectHasField(expr, bind)) return source;
  return insertObjectField(source, sf, expr, bind);
}

export function insertCall(
  source: string,
  job: Insert,
  nextId: () => string = freshSiteId,
): string {
  if (job.patchVertex) return patchProfileVertex(source, job);
  const specs = siteSpecs();
  if (!specs.has(job.from)) throw new Error(`unknown constructor ${job.from}`);
  const dest = job.dest?.trim() || "build";
  const parsed = parse(source);
  const destBody = findFnBody(parsed, dest);
  if (!destBody) throw new Error(`no function ${dest}() with a block body`);
  const used = usedInBody(destBody);
  const { exprs: args, hoists } = hoistIntersections(job.args, used);
  for (const h of hoists) {
    if (!specs.has(h.from)) throw new Error(`unknown constructor ${h.from}`);
  }
  const statements: { bind?: string; from: string; args: Expr[]; id: string }[] = hoists.map(
    (h) => ({ bind: h.bind, from: h.from, args: h.args, id: nextId() }),
  );
  if (EFFECT_CTORS.has(job.from)) {
    statements.push({ from: job.from, args, id: job.id ?? nextId() });
  } else {
    statements.push({
      bind: takeBind(used, job.from, job.bind),
      from: job.from,
      args,
      id: job.id ?? nextId(),
    });
  }
  const introduced = new Set(statements.flatMap((s) => (s.bind ? [s.bind] : [])));
  const scope = namesInFunctionScope(source, dest);
  const missing = [
    ...new Set(
      statements
        .flatMap((s) => s.args.flatMap(exprRefs))
        .filter((n) => !scope.has(n) && !introduced.has(n)),
    ),
  ];
  if (missing.length > 0) {
    const who = missing.join(", ");
    const verb = missing.length === 1 ? "is" : "are";
    throw new Error(`${who} ${verb} not in ${dest}() — this scope cannot refer to ${who}.`);
  }
  const names = [...new Set(statements.flatMap((s) => [s.from, ...s.args.flatMap(callees)]))];
  let next = ensureNamedImport(source, "oblik", names);
  const sf = parse(next);
  const body = findFnBody(sf, dest);
  if (!body) throw new Error(`no function ${dest}() with a block body`);
  const stmts = body.statements;
  const last = stmts[stmts.length - 1];
  const indent = last ? indentAt(next, last.getStart(sf)) : "    ";
  const chunk = statements
    .map((s) => {
      const call = `${s.from}(${s.args.map(printExpr).join(", ")}, "${s.id}")`;
      return s.bind ? `${indent}const ${s.bind} = ${call};\n` : `${indent}${call};\n`;
    })
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
