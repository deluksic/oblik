import * as ts from "typescript";

import { siteSpecs, trailingId } from "./analyze";

export type ReturnField = {
  field: string;
  /** Local bind in the helper, if the field is an identifier. */
  bind?: string;
  /** Trailing constructor id, when we can see one. */
  id?: string;
};

export type FnReturn =
  | { kind: "bag"; fields: ReturnField[] }
  | { kind: "value"; bind?: string; id?: string }
  | { kind: "none" }
  | { kind: "other" };

export type HelperBinding =
  | { kind: "const"; name: string }
  | { kind: "destructure"; map: Record<string, string> }
  | { kind: "none" };

export type HelperCall = {
  callee: string;
  line: number;
  column: number;
  binding: HelperBinding;
};

export type MentionFn = {
  /** Label for the breadcrumb; may be missing on anonymous arrows. */
  name?: string;
  file: string;
  start: number;
  end: number;
  startLine: number;
  endLine: number;
  /** Direct identifier params. */
  params: string[];
  /** `const` names declared as direct body statements (insert-point locals). */
  consts: string[];
  /** Outer same-file function insert-point names (closures). */
  closures: string[];
  /** Constructor ids in this function, not in a nested function. */
  ids: string[];
  /** Subset of `ids` whose site is not inside a loop in this function. */
  onceIds: string[];
  /** Local const name → constructor id for `const x = ctor(..., id)` in this function. */
  bindToId: Record<string, string>;
  return: FnReturn;
  calls: HelperCall[];
  hasBlock: boolean;
};

export type MentionFile = {
  file: string;
  functions: MentionFn[];
};

function parse(source: string, file: string): ts.SourceFile {
  return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function isFnLike(
  n: ts.Node,
): n is ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration {
  return ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isMethodDeclaration(n);
}

function identName(name: ts.PropertyName | ts.BindingName | undefined): string | undefined {
  if (!name) return undefined;
  if (ts.isIdentifier(name)) return name.text;
  if (ts.isStringLiteral(name)) return name.text;
  return undefined;
}

function fnName(node: ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration): string | undefined {
  if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.name) {
    return identName(node.name);
  }
  const parent = node.parent;
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
  if (ts.isPropertyAssignment(parent)) return identName(parent.name);
  return undefined;
}

function fnBody(node: ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration): ts.Block | undefined {
  if (!node.body) return undefined;
  if (ts.isBlock(node.body)) return node.body;
  return undefined;
}

function isLoop(n: ts.Node): boolean {
  return (
    ts.isForStatement(n) ||
    ts.isForOfStatement(n) ||
    ts.isForInStatement(n) ||
    ts.isWhileStatement(n) ||
    ts.isDoStatement(n)
  );
}

function insideLoop(node: ts.Node, fn: ts.Node): boolean {
  let n: ts.Node | undefined = node.parent;
  while (n && n !== fn) {
    if (isLoop(n)) return true;
    if (isFnLike(n)) return false;
    n = n.parent;
  }
  return false;
}

function enclosingFns(node: ts.Node): ts.Node[] {
  const out: ts.Node[] = [];
  let n: ts.Node | undefined = node.parent;
  while (n) {
    if (isFnLike(n)) out.push(n);
    n = n.parent;
  }
  return out;
}

function isConstDecl(d: ts.VariableDeclaration): boolean {
  const list = d.parent;
  return ts.isVariableDeclarationList(list) && (list.flags & ts.NodeFlags.Const) !== 0;
}

function addBindingName(name: ts.BindingName, into: string[]): void {
  if (ts.isIdentifier(name)) {
    into.push(name.text);
    return;
  }
  for (const el of name.elements) {
    if (ts.isBindingElement(el)) addBindingName(el.name, into);
  }
}

function unwrap(expr: ts.Expression): ts.Expression {
  let e = expr;
  while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e)) {
    e = e.expression;
  }
  return e;
}

function ctorId(call: ts.CallExpression, specs: Map<string, unknown>): string | undefined {
  if (!ts.isIdentifier(call.expression)) return undefined;
  if (!specs.has(call.expression.text)) return undefined;
  const { id } = trailingId(call);
  return id || undefined;
}

function bindToIdInFn(
  fn: ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration,
  specs: Map<string, unknown>,
): Record<string, string> {
  const out: Record<string, string> = {};
  const body = fnBody(fn);
  if (!body) return out;
  const visit = (node: ts.Node) => {
    if (node !== fn && isFnLike(node)) return;
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && specs.has(node.expression.text)) {
      const { id } = trailingId(node);
      if (id) {
        let p: ts.Node = node.parent;
        while (ts.isAsExpression(p) || ts.isParenthesizedExpression(p) || ts.isSatisfiesExpression(p)) p = p.parent;
        if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name) && isConstDecl(p)) {
          out[p.name.text] = id;
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return out;
}

function idsInFn(
  fn: ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration,
  specs: Map<string, unknown>,
): { ids: string[]; onceIds: string[] } {
  const ids: string[] = [];
  const onceIds: string[] = [];
  const body = fnBody(fn);
  if (!body) return { ids, onceIds };
  const visit = (node: ts.Node) => {
    if (node !== fn && isFnLike(node)) return;
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && specs.has(node.expression.text)) {
      const { id } = trailingId(node);
      if (id) {
        ids.push(id);
        if (!insideLoop(node, fn)) onceIds.push(id);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return { ids, onceIds };
}

function fieldFromInit(init: ts.Expression, bindToId: Record<string, string>, specs: Map<string, unknown>): Pick<ReturnField, "bind" | "id"> {
  const e = unwrap(init);
  if (ts.isIdentifier(e)) return { bind: e.text, id: bindToId[e.text] };
  if (ts.isCallExpression(e)) {
    const id = ctorId(e, specs);
    if (id) return { id };
  }
  return {};
}

function analyzeReturn(
  fn: ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration,
  bindToId: Record<string, string>,
  specs: Map<string, unknown>,
): FnReturn {
  const body = fnBody(fn);
  if (!body) {
    if (ts.isArrowFunction(fn) && fn.body && !ts.isBlock(fn.body)) {
      const e = unwrap(fn.body);
      if (ts.isIdentifier(e)) return { kind: "value", bind: e.text, id: bindToId[e.text] };
      if (ts.isObjectLiteralExpression(e)) return bagOf(e, bindToId, specs);
      if (ts.isCallExpression(e)) {
        const id = ctorId(e, specs);
        if (id) return { kind: "value", id };
        return { kind: "other" };
      }
      return { kind: "other" };
    }
    return { kind: "none" };
  }
  let ret: ts.ReturnStatement | undefined;
  for (let i = body.statements.length - 1; i >= 0; i--) {
    const s = body.statements[i];
    if (s && ts.isReturnStatement(s)) {
      ret = s;
      break;
    }
  }
  if (!ret?.expression) return { kind: "none" };
  const e = unwrap(ret.expression);
  if (ts.isObjectLiteralExpression(e)) return bagOf(e, bindToId, specs);
  if (ts.isIdentifier(e)) return { kind: "value", bind: e.text, id: bindToId[e.text] };
  if (ts.isCallExpression(e)) {
    const id = ctorId(e, specs);
    if (id) return { kind: "value", id };
    return { kind: "other" };
  }
  return { kind: "other" };
}

function bagOf(obj: ts.ObjectLiteralExpression, bindToId: Record<string, string>, specs: Map<string, unknown>): FnReturn {
  const fields: ReturnField[] = [];
  for (const p of obj.properties) {
    if (ts.isShorthandPropertyAssignment(p)) {
      fields.push({ field: p.name.text, bind: p.name.text, id: bindToId[p.name.text] });
      continue;
    }
    if (ts.isPropertyAssignment(p)) {
      const field = identName(p.name);
      if (!field) continue;
      fields.push({ field, ...fieldFromInit(p.initializer, bindToId, specs) });
    }
  }
  return { kind: "bag", fields };
}

function helperBinding(call: ts.CallExpression): HelperBinding {
  let n: ts.Node = call.parent;
  while (ts.isAsExpression(n) || ts.isParenthesizedExpression(n) || ts.isSatisfiesExpression(n)) n = n.parent;
  if (ts.isVariableDeclaration(n)) {
    if (ts.isIdentifier(n.name)) return { kind: "const", name: n.name.text };
    if (ts.isObjectBindingPattern(n.name)) {
      const map: Record<string, string> = {};
      for (const el of n.name.elements) {
        if (!ts.isBindingElement(el) || el.dotDotDotToken) continue;
        if (!ts.isIdentifier(el.name)) continue;
        const field = el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName.text : el.name.text;
        map[field] = el.name.text;
      }
      return { kind: "destructure", map };
    }
  }
  return { kind: "none" };
}

/** Unmarked geom helpers (`$site`-less). Not user callees; recording them poisons nested live. */
const GEOM_HELPERS = new Set(["fillet", "along", "dist", "signedDist"]);

function callsInFn(
  fn: ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration,
  sf: ts.SourceFile,
  specs: Map<string, unknown>,
): HelperCall[] {
  const out: HelperCall[] = [];
  const body = fn.body;
  if (!body) return out;
  const root: ts.Node = ts.isBlock(body) ? body : body;
  const visit = (node: ts.Node) => {
    if (node !== fn && isFnLike(node)) return;
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      !specs.has(node.expression.text) &&
      !GEOM_HELPERS.has(node.expression.text)
    ) {
      const pos = sf.getLineAndCharacterOfPosition(node.getStart(sf));
      out.push({
        callee: node.expression.text,
        line: pos.line + 1,
        column: pos.character + 1,
        binding: helperBinding(node),
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return out;
}

function directConsts(body: ts.Block): string[] {
  const names: string[] = [];
  for (const stmt of body.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const d of stmt.declarationList.declarations) {
      if (!isConstDecl(d)) continue;
      addBindingName(d.name, names);
    }
  }
  return names;
}

function paramsOf(fn: ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration): string[] {
  const names: string[] = [];
  for (const p of fn.parameters) addBindingName(p.name, names);
  return names;
}

/** Functions in `source`, innermost last when nested. */
export function analyzeMentions(source: string, file = "scene.ts"): MentionFile {
  const sf = parse(source, file);
  const specs = siteSpecs();
  const raw: Array<{
    node: ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration;
  }> = [];
  const visit = (node: ts.Node) => {
    if (isFnLike(node)) raw.push({ node });
    ts.forEachChild(node, visit);
  };
  visit(sf);

  const functions: MentionFn[] = raw.map(({ node }) => {
    const bindToId = bindToIdInFn(node, specs);
    const { ids, onceIds } = idsInFn(node, specs);
    const body = fnBody(node);
    const outer = enclosingFns(node);
    const closures: string[] = [];
    for (const o of outer) {
      if (!isFnLike(o)) continue;
      const b = fnBody(o);
      if (b) closures.push(...directConsts(b), ...paramsOf(o));
    }
    return {
      name: fnName(node),
      file,
      start: node.getStart(sf),
      end: node.getEnd(),
      startLine: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
      endLine: sf.getLineAndCharacterOfPosition(node.getEnd()).line + 1,
      params: paramsOf(node),
      consts: body ? directConsts(body) : [],
      closures,
      ids,
      onceIds,
      bindToId,
      return: analyzeReturn(node, bindToId, specs),
      calls: callsInFn(node, sf, specs),
      hasBlock: body != null,
    };
  });

  return { file, functions };
}

export function fnAt(file: MentionFile, pos: number): MentionFn | undefined {
  let best: MentionFn | undefined;
  for (const fn of file.functions) {
    if (pos < fn.start || pos >= fn.end) continue;
    if (!best || fn.end - fn.start < best.end - fn.start) best = fn;
  }
  return best;
}

export function fnNamed(file: MentionFile, name: string): MentionFn | undefined {
  return file.functions.find((f) => f.name === name);
}

/** Names legal at the function tail: module imports are added by the caller. */
export function insertPointNames(fn: MentionFn): Set<string> {
  return new Set([...fn.params, ...fn.consts, ...fn.closures]);
}
