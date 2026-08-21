import * as ts from "typescript";

import { findEditCallAt } from "./patch-widget";

const SCENE_DRAWN = "__scene";

export type SourceAt = { line: number; column: number };

export type EditorInsert =
  | { kind: "point"; x: number; y: number }
  | { kind: "distance"; originName?: string; d: number }
  | { kind: "circle"; center: string; radius: string }
  | { kind: "line"; a: string; b: string };

export function formatNum(n: number): string {
  const q = Math.round(n * 100) / 100;
  if (Object.is(q, -0)) return "0";
  return String(q);
}

function parse(source: string): ts.SourceFile {
  return ts.createSourceFile("scene.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function isInNode(node: ts.Node, ancestor: ts.Node): boolean {
  let n: ts.Node | undefined = node;
  while (n) {
    if (n === ancestor) return true;
    n = n.parent;
  }
  return false;
}

export function findSceneFunction(sourceFile: ts.SourceFile): ts.FunctionDeclaration | null {
  for (const stmt of sourceFile.statements) {
    if (
      ts.isFunctionDeclaration(stmt) &&
      stmt.name?.text === "scene" &&
      stmt.body &&
      stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      return stmt;
    }
  }
  return null;
}

/** Const name if this edit* is `const foo = editPoint(...)`. */
export function widgetBindingName(source: string, at: SourceAt): string | null {
  const sf = parse(source);
  const call = findEditCallAt(sf, at.line, at.column);
  if (!call) return null;
  let n: ts.Node = call.parent;
  while (ts.isAsExpression(n) || ts.isParenthesizedExpression(n) || ts.isSatisfiesExpression(n)) {
    n = n.parent;
  }
  if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name)) return n.name.text;
  return null;
}

/** True when that widget’s call sits inside exported `scene()`. */
export function widgetInSceneFunction(source: string, at: SourceAt): boolean {
  const sf = parse(source);
  const fn = findSceneFunction(sf);
  const call = findEditCallAt(sf, at.line, at.column);
  if (!fn || !call) return false;
  return isInNode(call, fn);
}

export type ScenePointBinding = {
  name: string;
  kind: "editPoint" | "derived";
};

/**
 * Named 2D points in exported `scene()`: `editPoint` and derived `const p = point(...)`.
 * Closest match to (x, y) within `maxDist` wins; `null` if none.
 */
export function namedScenePointNear(
  source: string,
  x: number,
  y: number,
  evals: ReadonlyArray<{ name: string; x: number; y: number }>,
  maxDist = 0.35,
): ScenePointBinding | null {
  const names = namedScenePointBindings(source);
  let best: { name: string; kind: ScenePointBinding["kind"]; d: number } | null = null;
  for (const e of evals) {
    const kind = names.get(e.name);
    if (!kind) continue;
    const d = Math.hypot(e.x - x, e.y - y);
    if (d > maxDist) continue;
    if (!best || d < best.d) best = { name: e.name, kind, d };
  }
  return best ? { name: best.name, kind: best.kind } : null;
}

export function namedScenePointBindings(source: string): Map<string, ScenePointBinding["kind"]> {
  const sf = parse(source);
  const fn = findSceneFunction(sf);
  const names = new Map<string, ScenePointBinding["kind"]>();
  if (!fn?.body) return names;
  for (const stmt of fn.body.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
      const call = unwrapCall(decl.initializer);
      if (!call || !ts.isIdentifier(call.expression)) continue;
      const fnName = call.expression.text;
      if (fnName === "editPoint") names.set(decl.name.text, "editPoint");
      else if (fnName === "point") names.set(decl.name.text, "derived");
    }
  }
  return names;
}

function numericLiteral(node: ts.Expression): number | null {
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (
    ts.isPrefixUnaryExpression(node) &&
    node.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(node.operand)
  ) {
    return -Number(node.operand.text);
  }
  return null;
}

function evalBinary(node: ts.BinaryExpression, env: Map<string, Vec2Like>): number | null {
  const l = evalNumber(node.left, env);
  const r = evalNumber(node.right, env);
  if (l == null || r == null) return null;
  switch (node.operatorToken.kind) {
    case ts.SyntaxKind.PlusToken:
      return l + r;
    case ts.SyntaxKind.MinusToken:
      return l - r;
    case ts.SyntaxKind.AsteriskToken:
      return l * r;
    case ts.SyntaxKind.SlashToken:
      return r === 0 ? null : l / r;
    default:
      return null;
  }
}

type Vec2Like = { x: number; y: number };

function evalNumber(node: ts.Expression, env: Map<string, Vec2Like>): number | null {
  const lit = numericLiteral(node);
  if (lit != null) return lit;
  if (ts.isParenthesizedExpression(node)) return evalNumber(node.expression, env);
  if (ts.isBinaryExpression(node)) return evalBinary(node, env);
  if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
    const v = env.get(node.expression.text);
    if (!v) return null;
    if (node.name.text === "x") return v.x;
    if (node.name.text === "y") return v.y;
  }
  return null;
}

/** Evaluate named `const p = point(...)` in scene() using known editor positions. */
export function evalDerivedScenePoints(
  source: string,
  known: ReadonlyArray<{ name: string; x: number; y: number }>,
): { name: string; x: number; y: number }[] {
  const sf = parse(source);
  const fn = findSceneFunction(sf);
  if (!fn?.body) return [];
  const env = new Map<string, Vec2Like>();
  for (const k of known) env.set(k.name, { x: k.x, y: k.y });
  const out: { name: string; x: number; y: number }[] = [];
  for (const stmt of fn.body.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
      const call = unwrapCall(decl.initializer);
      if (!call || !ts.isIdentifier(call.expression)) continue;
      if (call.expression.text !== "point") continue;
      const ax = call.arguments[0];
      const ay = call.arguments[1];
      if (!ax || !ay) continue;
      const x = evalNumber(ax, env);
      const y = evalNumber(ay, env);
      if (x == null || y == null) continue;
      env.set(decl.name.text, { x, y });
      out.push({ name: decl.name.text, x, y });
    }
  }
  return out;
}

function unwrapCall(node: ts.Expression): ts.CallExpression | null {
  let n: ts.Expression = node;
  while (ts.isAsExpression(n) || ts.isParenthesizedExpression(n) || ts.isSatisfiesExpression(n)) {
    n = n.expression;
  }
  return ts.isCallExpression(n) ? n : null;
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

function freshName(prefix: string, used: Set<string>): string {
  if (!used.has(prefix)) {
    used.add(prefix);
    return prefix;
  }
  for (let i = 2; i < 1000; i++) {
    const n = `${prefix}${i}`;
    if (!used.has(n)) {
      used.add(n);
      return n;
    }
  }
  throw new Error(`could not allocate a name starting with ${prefix}`);
}

function indentAt(source: string, pos: number): string {
  const lineStart = source.lastIndexOf("\n", pos - 1) + 1;
  const m = source.slice(lineStart, pos).match(/^[ \t]*/);
  return m?.[0] ?? "  ";
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
  if (!last) {
    throw new Error(`empty named import from ${moduleName}`);
  }
  return source.slice(0, last.getEnd()) + `, ${missing.join(", ")}` + source.slice(last.getEnd());
}

/** First argument identifier of editDistanceToPoint(...) at this site, if any. */
export function distanceOriginName(source: string, at: SourceAt): string | null {
  const sf = parse(source);
  const call = findEditCallAt(sf, at.line, at.column);
  if (!call) return null;
  const expr = call.expression;
  if (!ts.isIdentifier(expr) || expr.text !== "editDistanceToPoint") {
    return null;
  }
  const first = call.arguments[0];
  if (!first || !ts.isIdentifier(first)) return null;
  return first.text;
}

function lineStartAt(source: string, pos: number): number {
  return source.lastIndexOf("\n", pos - 1) + 1;
}

function appendConstructorToReturn(
  source: string,
  fn: ts.FunctionDeclaration,
  ctorExpr: string,
): string {
  const body = fn.body;
  if (!body) throw new Error("scene() has no body");
  const stmts = body.statements;
  const last = stmts[stmts.length - 1];
  if (!last || !ts.isReturnStatement(last) || !last.expression) {
    throw new Error("scene() must end with a return of some geometry");
  }
  const sf = fn.getSourceFile();
  const retExpr = last.expression;
  const start = last.getStart(sf);
  const lineStart = lineStartAt(source, start);
  const indent = indentAt(source, start);

  if (
    ts.isCallExpression(retExpr) &&
    ts.isIdentifier(retExpr.expression) &&
    retExpr.expression.text === "group"
  ) {
    const arrow = retExpr.arguments[0];
    if (!arrow || !ts.isArrowFunction(arrow) || !ts.isArrayLiteralExpression(arrow.body)) {
      throw new Error("group return must be group(() => [...])");
    }
    const arr = arrow.body;
    const lastEl = arr.elements[arr.elements.length - 1];
    if (!lastEl) throw new Error("group array is empty");
    const insertPos = lastEl.getEnd();
    return source.slice(0, insertPos) + `, ${ctorExpr}` + source.slice(insertPos);
  }

  if (ts.isIdentifier(retExpr) && retExpr.text === SCENE_DRAWN) {
    return (
      source.slice(0, lineStart) +
      `${indent}return group(() => [${SCENE_DRAWN}, ${ctorExpr}]);\n` +
      source.slice(last.getEnd())
    );
  }

  const exprText = source.slice(retExpr.getStart(sf), retExpr.getEnd());
  const chunk =
    `${indent}const ${SCENE_DRAWN} = ${exprText};\n` +
    `${indent}return group(() => [${SCENE_DRAWN}, ${ctorExpr}]);\n`;
  return source.slice(0, lineStart) + chunk + source.slice(last.getEnd());
}

function sceneAlreadyBindsDrawn(fn: ts.FunctionDeclaration): boolean {
  const body = fn.body;
  if (!body) return false;
  for (const stmt of body.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (ts.isIdentifier(decl.name) && decl.name.text === SCENE_DRAWN) {
        return true;
      }
    }
  }
  return false;
}

function insertBeforeReturn(source: string, fn: ts.FunctionDeclaration, lines: string[]): string {
  const body = fn.body;
  if (!body) throw new Error("scene() has no body");
  const stmts = body.statements;
  const last = stmts[stmts.length - 1];
  if (!last || !ts.isReturnStatement(last) || !last.expression) {
    throw new Error("scene() must end with a return of some geometry");
  }
  const sf = fn.getSourceFile();
  const start = last.getStart(sf);
  const lineStart = lineStartAt(source, start);
  const indent = indentAt(source, start);
  const expr = last.expression;
  const keepReturn =
    (ts.isIdentifier(expr) && expr.text === SCENE_DRAWN) || sceneAlreadyBindsDrawn(fn);
  if (keepReturn) {
    const chunk = lines.map((ln) => `${indent}${ln}\n`).join("");
    return source.slice(0, lineStart) + chunk + source.slice(lineStart);
  }
  const exprText = source.slice(expr.getStart(sf), expr.getEnd());
  const chunk =
    `${indent}const ${SCENE_DRAWN} = ${exprText};\n` +
    lines.map((ln) => `${indent}${ln}\n`).join("") +
    `${indent}return ${SCENE_DRAWN};`;
  return source.slice(0, lineStart) + chunk + source.slice(last.getEnd());
}

export function insertEditors(source: string, edits: EditorInsert[]): string {
  if (edits.length === 0) return source;

  const constructors = edits.filter((e) => e.kind === "circle" || e.kind === "line");
  const editors = edits.filter((e) => e.kind === "point" || e.kind === "distance");
  if (constructors.length > 0 && editors.length > 0) {
    throw new Error("cannot mix editor and constructor inserts in one write");
  }
  if (constructors.length > 1) {
    throw new Error("one constructor insert per write");
  }
  if (constructors.length === 1) {
    const c = constructors[0]!;
    const imports =
      c.kind === "circle" ? (["circle", "group"] as const) : (["line", "group"] as const);
    const withImports = ensureNamedImport(source, "@design-scenes/geom", imports);
    const sf = parse(withImports);
    const fn = findSceneFunction(sf);
    if (!fn) throw new Error("no exported scene() function to insert into");
    const expr = c.kind === "circle" ? `circle(${c.center}, ${c.radius})` : `line(${c.a}, ${c.b})`;
    return appendConstructorToReturn(withImports, fn, expr);
  }

  const imports: string[] = [];
  for (const e of edits) {
    if (e.kind === "point" && !imports.includes("editPoint")) {
      imports.push("editPoint");
    }
    if (e.kind === "distance" && !imports.includes("editDistanceToPoint")) {
      imports.push("editDistanceToPoint");
    }
  }
  const withImports = ensureNamedImport(source, "@design-scenes/euclid2", imports);
  const sf = parse(withImports);
  const fn = findSceneFunction(sf);
  if (!fn) throw new Error("no exported scene() function to insert into");
  const used = usedIdentifiers(sf);
  const lines: string[] = [];
  let lastPoint: string | undefined;
  for (const e of edits) {
    if (e.kind === "point") {
      const name = freshName("p", used);
      lastPoint = name;
      lines.push(`const ${name} = editPoint(${formatNum(e.x)}, ${formatNum(e.y)});`);
    } else {
      const origin = e.originName ?? lastPoint;
      if (!origin) {
        throw new Error("distance needs a point in scene() or a new point first");
      }
      const name = freshName("d", used);
      lines.push(`const ${name} = editDistanceToPoint(${origin}, ${formatNum(e.d)});`);
    }
  }
  return insertBeforeReturn(withImports, fn, lines);
}
