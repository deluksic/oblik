import * as ts from "typescript";

const SCENE_DRAWN = "__scene";

const EDIT_NAMES = new Set([
  "editPoint",
  "editPoint3",
  "editDistanceToPoint",
  "editDistance3",
  "editPointOnLine",
  "editPointOnLine3",
  "editNumber",
  "editAngle",
]);

export type EditorInsert =
  | { kind: "point"; x: number; y: number }
  | { kind: "distance"; originName?: string; d: number };

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

function collectEditCalls(sourceFile: ts.SourceFile): ts.CallExpression[] {
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

function isInNode(node: ts.Node, ancestor: ts.Node): boolean {
  let n: ts.Node | undefined = node;
  while (n) {
    if (n === ancestor) return true;
    n = n.parent;
  }
  return false;
}

export function findSceneFunction(
  sourceFile: ts.SourceFile,
): ts.FunctionDeclaration | null {
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
export function widgetBindingName(
  source: string,
  widgetIndex: number,
): string | null {
  const sf = parse(source);
  const call = collectEditCalls(sf)[widgetIndex];
  if (!call) return null;
  let n: ts.Node = call.parent;
  while (
    ts.isAsExpression(n) ||
    ts.isParenthesizedExpression(n) ||
    ts.isSatisfiesExpression(n)
  ) {
    n = n.parent;
  }
  if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name)) return n.name.text;
  return null;
}

/** True when that widget’s call sits inside exported `scene()`. */
export function widgetInSceneFunction(
  source: string,
  widgetIndex: number,
): boolean {
  const sf = parse(source);
  const fn = findSceneFunction(sf);
  const call = collectEditCalls(sf)[widgetIndex];
  if (!fn || !call) return false;
  return isInNode(call, fn);
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
  const have = new Set(
    named.elements.map((el) => (el.propertyName ?? el.name).text),
  );
  const missing = names.filter((n) => !have.has(n));
  if (missing.length === 0) return source;
  const last = named.elements[named.elements.length - 1];
  if (!last) {
    throw new Error(`empty named import from ${moduleName}`);
  }
  return (
    source.slice(0, last.getEnd()) +
    `, ${missing.join(", ")}` +
    source.slice(last.getEnd())
  );
}

function insertBeforeReturn(
  source: string,
  fn: ts.FunctionDeclaration,
  lines: string[],
): string {
  const body = fn.body;
  if (!body) throw new Error("scene() has no body");
  const stmts = body.statements;
  const last = stmts[stmts.length - 1];
  if (!last || !ts.isReturnStatement(last) || !last.expression) {
    throw new Error("scene() must end with a return of some geometry");
  }
  const sf = fn.getSourceFile();
  const start = last.getStart(sf);
  const indent = indentAt(source, start);
  const expr = last.expression;
  if (ts.isIdentifier(expr) && expr.text === SCENE_DRAWN) {
    const chunk = lines.map((ln) => `${indent}${ln}\n`).join("");
    return source.slice(0, start) + chunk + source.slice(start);
  }
  const exprText = source.slice(expr.getStart(sf), expr.getEnd());
  const chunk =
    `${indent}const ${SCENE_DRAWN} = ${exprText};\n` +
    lines.map((ln) => `${indent}${ln}\n`).join("") +
    `${indent}return ${SCENE_DRAWN};`;
  return source.slice(0, start) + chunk + source.slice(last.getEnd());
}

export function insertEditors(source: string, edits: EditorInsert[]): string {
  if (edits.length === 0) return source;
  const imports: string[] = [];
  for (const e of edits) {
    if (e.kind === "point" && !imports.includes("editPoint")) {
      imports.push("editPoint");
    }
    if (e.kind === "distance" && !imports.includes("editDistanceToPoint")) {
      imports.push("editDistanceToPoint");
    }
  }
  const withImports = ensureNamedImport(
    source,
    "@design-scenes/euclid2",
    imports,
  );
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
      lines.push(
        `const ${name} = editPoint(${formatNum(e.x)}, ${formatNum(e.y)});`,
      );
    } else {
      const origin = e.originName ?? lastPoint;
      if (!origin) {
        throw new Error("distance needs a point in scene() or a new point first");
      }
      const name = freshName("d", used);
      lines.push(
        `const ${name} = editDistanceToPoint(${origin}, ${formatNum(e.d)});`,
      );
    }
  }
  return insertBeforeReturn(withImports, fn, lines);
}
