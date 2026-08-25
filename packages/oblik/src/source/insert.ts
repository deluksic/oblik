import * as ts from "typescript";

import { siteSpecs } from "./analyze";
import { printExpr, type Expr } from "./expr";
import { freshSiteId } from "./stamp";

export type Insert = {
  file?: string;
  from: string;
  bind?: string;
  args: Expr[];
  id?: string;
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

const BIND = /^[A-Za-z_][A-Za-z0-9_]*$/;

const PREFIX: Record<string, string> = {
  point: "p",
  circle: "c",
  line: "l",
  segment: "s",
  offsetLine: "off",
};

export function freshBind(source: string, from: string, requested?: string): string {
  const used = usedIdentifiers(parse(source));
  if (requested?.trim()) {
    const n = requested.trim();
    if (!BIND.test(n)) throw new Error("bind must be an identifier");
    if (used.has(n)) throw new Error(`bind ${n} is already used`);
    return n;
  }
  const prefix = PREFIX[from] ?? "n";
  if (!used.has(prefix)) return prefix;
  for (let i = 2; i < 1000; i++) {
    const n = `${prefix}${i}`;
    if (!used.has(n)) return n;
  }
  throw new Error(`could not allocate bind for ${from}`);
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
  return [];
}

export function insertCall(source: string, job: Insert, nextId: () => string = freshSiteId): string {
  const specs = siteSpecs();
  if (!specs.has(job.from)) throw new Error(`unknown constructor ${job.from}`);
  const bind = freshBind(source, job.from, job.bind);
  const id = job.id ?? nextId();
  const args = job.args.map(printExpr).join(", ");
  const line = `const ${bind} = ${job.from}(${args}, "${id}");`;
  const names = [...new Set([job.from, ...job.args.flatMap(callees)])];
  let next = ensureNamedImport(source, "oblik", names);
  const sf = parse(next);
  const body = findBuildBody(sf);
  if (!body) throw new Error("no defineScene({ build() { … } })");
  const stmts = body.statements;
  const last = stmts[stmts.length - 1];
  const indent = last ? indentAt(next, last.getStart(sf)) : "    ";
  const chunk = `${indent}${line}\n`;
  if (last && ts.isReturnStatement(last)) {
    const lineStart = next.lastIndexOf("\n", last.getStart(sf) - 1) + 1;
    return next.slice(0, lineStart) + chunk + next.slice(lineStart);
  }
  const close = body.getEnd() - 1;
  const before = next.slice(0, close);
  const prefix = before.endsWith("\n") ? "" : "\n";
  return before + prefix + chunk + next.slice(close);
}
