import * as ts from "typescript";

import { SITE_CALL_NAMES } from "./call-sites.ts";
import { findEditCallAt, findIdentifierCallAt } from "./patch-widget.ts";


const { abs, max, min, round, sqrt } = Math;
export type SourceAt = { line: number; column: number };

export type PointRef = { name: string } | { x: number; y: number };

export type EditorInsert =
  | { kind: "point"; x: number; y: number }
  | { kind: "distance"; originName?: string; d: number }
  | ({ kind: "circle"; center: PointRef } & ({ radius: string } | { r: number }))
  | { kind: "segment"; a: PointRef; b: PointRef }
  | { kind: "infiniteLine"; a: PointRef; b: PointRef }
  | { kind: "intersection"; a: string; b: string }
  | { kind: "rect"; a: PointRef; b: PointRef }
  | { kind: "offsetFirst"; base: string; d: number }
  | { kind: "offsetReuse"; base: string; inset: string };

export function formatNum(n: number): string {
  const q = round(n * 100) / 100;
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

/** Const name if this call is `const foo = point(...)`. */
export function widgetBindingName(source: string, at: SourceAt): string | null {
  const sf = parse(source);
  const call = findIdentifierCallAt(sf, at.line, at.column, (n) => SITE_CALL_NAMES.has(n));
  if (!call) return null;
  let n: ts.Node = call.parent;
  while (ts.isAsExpression(n) || ts.isParenthesizedExpression(n) || ts.isSatisfiesExpression(n)) {
    n = n.parent;
  }
  if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name)) return n.name.text;
  return null;
}

export function widgetCallName(source: string, at: SourceAt): string | null {
  const sf = parse(source);
  const call = findIdentifierCallAt(sf, at.line, at.column, (n) => SITE_CALL_NAMES.has(n));
  if (!call || !ts.isIdentifier(call.expression)) return null;
  return call.expression.text;
}

/** True when that widget’s call sits inside exported `scene()`. */
export function widgetInSceneFunction(source: string, at: SourceAt): boolean {
  const sf = parse(source);
  const fn = findSceneFunction(sf);
  const call = findIdentifierCallAt(sf, at.line, at.column, (n) => SITE_CALL_NAMES.has(n));
  if (!fn || !call) return false;
  return isInNode(call, fn);
}

export type ScenePointBinding = {
  name: string;
  kind: "point" | "derived";
};

/**
 * Named 2D points in exported `scene()`: `point(...)` and derived intersections.
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
    const d = sqrt((e.x - x) * (e.x - x) + (e.y - y) * (e.y - y));
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
      if (fnName === "point") names.set(decl.name.text, "point");
      else if (
        fnName === "lineIntersection" ||
        fnName === "circleLineIntersection" ||
        fnName === "circleCircleIntersection"
      ) {
        names.set(decl.name.text, "derived");
      }
    }
  }
  return names;
}

export type SceneLineBindingKind = "segment" | "line" | "offsetLine";

/** Named line-like geometry in exported `scene()`. */
export function namedSceneLineBindings(source: string): Map<string, SceneLineBindingKind> {
  const sf = parse(source);
  const fn = findSceneFunction(sf);
  const names = new Map<string, SceneLineBindingKind>();
  if (!fn?.body) return names;
  for (const stmt of fn.body.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
      const call = unwrapCall(decl.initializer);
      if (!call || !ts.isIdentifier(call.expression)) continue;
      const fnName = call.expression.text;
      if (fnName === "segment") names.set(decl.name.text, "segment");
      else if (fnName === "line") names.set(decl.name.text, "line");
      else if (fnName === "offsetLine") names.set(decl.name.text, "offsetLine");
      else if (fnName === "perpendicularLine") names.set(decl.name.text, "line");
    }
  }
  return names;
}

export type SceneLineEval = {
  name: string;
  kind: SceneLineBindingKind;
  origin: Vec2Like;
  dir: Vec2Like;
  a?: Vec2Like;
  b?: Vec2Like;
};

function numericLiteral(node: ts.Expression): number | null {
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (ts.isPrefixUnaryExpression(node) && ts.isNumericLiteral(node.operand)) {
    const n = Number(node.operand.text);
    if (node.operator === ts.SyntaxKind.MinusToken) return -n;
    if (node.operator === ts.SyntaxKind.PlusToken) return n;
  }
  return null;
}

type Vec2Like = { x: number; y: number };

function cross2(a: Vec2Like, b: Vec2Like): number {
  return a.x * b.y - a.y * b.x;
}

function add(a: Vec2Like, b: Vec2Like): Vec2Like {
  return { x: a.x + b.x, y: a.y + b.y };
}

function sub(a: Vec2Like, b: Vec2Like): Vec2Like {
  return { x: a.x - b.x, y: a.y - b.y };
}

function mul(v: Vec2Like, s: number): Vec2Like {
  return { x: v.x * s, y: v.y * s };
}

function norm(v: Vec2Like): Vec2Like {
  const l = sqrt((v.x) * (v.x) + (v.y) * (v.y));
  if (l < 1e-9) return { x: 1, y: 0 };
  return { x: v.x / l, y: v.y / l };
}

function perp(v: Vec2Like): Vec2Like {
  return { x: -v.y, y: v.x };
}

function lineBasisFromEndpoints(a: Vec2Like, b: Vec2Like): { origin: Vec2Like; dir: Vec2Like } {
  return { origin: a, dir: norm(sub(b, a)) };
}

function offsetLineBasis(line: { origin: Vec2Like; dir: Vec2Like }, d: number): {
  origin: Vec2Like;
  dir: Vec2Like;
} {
  const o = add(line.origin, mul(perp(line.dir), d));
  return { origin: o, dir: line.dir };
}

function lineIntersectionMath(
  a: { origin: Vec2Like; dir: Vec2Like },
  b: { origin: Vec2Like; dir: Vec2Like },
): Vec2Like | null {
  const denom = cross2(a.dir, b.dir);
  if (abs(denom) < 1e-12) return null;
  const t = cross2(sub(b.origin, a.origin), b.dir) / denom;
  return add(a.origin, mul(a.dir, t));
}

function dot2(a: Vec2Like, b: Vec2Like): number {
  return a.x * b.x + a.y * b.y;
}

function circleLineMath(
  c: { center: Vec2Like; radius: number },
  l: { origin: Vec2Like; dir: Vec2Like },
  k: number,
): Vec2Like | null {
  const w = sub(l.origin, c.center);
  const dw = dot2(l.dir, w);
  const disc = dw * dw - (dot2(w, w) - c.radius * c.radius);
  if (!(disc >= 0) || !Number.isFinite(disc)) return null;
  const t = -dw + k * sqrt(disc);
  const p = add(l.origin, mul(l.dir, t));
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
  return p;
}

function pointRef(node: ts.Expression): string | null {
  if (ts.isIdentifier(node)) return node.text;
  return null;
}

function lineArgName(node: ts.Expression | undefined): string | null {
  if (!node) return null;
  if (ts.isIdentifier(node)) return node.text;
  if (
    ts.isPropertyAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.name.text === "line"
  ) {
    return node.expression.text;
  }
  return null;
}

function evalOffsetDistance(
  node: ts.Expression | undefined,
  offsetEvals: ReadonlyMap<string, number> | undefined,
  distances: ReadonlyMap<string, number>,
): number | null {
  if (!node) return null;
  const lit = numericLiteral(node);
  if (lit != null) return lit;
  if (ts.isIdentifier(node)) {
    return offsetEvals?.get(node.text) ?? distances.get(node.text) ?? null;
  }
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) {
    const inner = evalOffsetDistance(node.operand, offsetEvals, distances);
    return inner == null ? null : -inner;
  }
  if (
    ts.isPropertyAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.name.text === "distance"
  ) {
    return offsetEvals?.get(node.expression.text) ?? distances.get(node.expression.text) ?? null;
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

function evalNumber(node: ts.Expression, env: Map<string, Vec2Like>): number | null {
  const lit = numericLiteral(node);
  if (lit != null) return lit;
  if (ts.isParenthesizedExpression(node)) return evalNumber(node.expression, env);
  if (ts.isBinaryExpression(node)) return evalBinary(node, env);
  if (ts.isCallExpression(node)) {
    const call = unwrapCall(node);
    if (!call || !ts.isIdentifier(call.expression)) return null;
    if (call.expression.text === "min" || call.expression.text === "max") {
      const args = call.arguments
        .map((arg) => evalNumber(arg, env))
        .filter((n): n is number => n != null);
      if (args.length !== call.arguments.length) return null;
      return call.expression.text === "min" ? min(...args) : max(...args);
    }
    if (call.expression.text === "dist") {
      const aName = call.arguments[0] ? pointRef(call.arguments[0]) : null;
      const bName = call.arguments[1] ? pointRef(call.arguments[1]) : null;
      if (!aName || !bName) return null;
      const a = env.get(aName);
      const b = env.get(bName);
      if (!a || !b) return null;
      return sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y));
    }
  }
  if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
    const v = env.get(node.expression.text);
    if (!v) return null;
    if (node.name.text === "x") return v.x;
    if (node.name.text === "y") return v.y;
  }
  return null;
}

function resolvePointRef(name: string, env: ReadonlyMap<string, Vec2Like>): Vec2Like | null {
  return env.get(name) ?? null;
}

/** Evaluate named line-like geometry in scene() from known points and optional offset values. */
export function evalSceneLines(
  source: string,
  pointEnv: ReadonlyMap<string, Vec2Like>,
  offsetEvals?: ReadonlyMap<string, number>,
): SceneLineEval[] {
  const sf = parse(source);
  const fn = findSceneFunction(sf);
  if (!fn?.body) return [];
  const env = new Map<string, { origin: Vec2Like; dir: Vec2Like; a?: Vec2Like; b?: Vec2Like }>();
  const distances = new Map<string, number>();
  const out: SceneLineEval[] = [];
  for (const stmt of fn.body.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
      const call = unwrapCall(decl.initializer);
      if (!call || !ts.isIdentifier(call.expression)) continue;
      const fnName = call.expression.text;
      if (fnName === "segment" || fnName === "line") {
        const aName = call.arguments[0] ? pointRef(call.arguments[0]) : null;
        const bName = call.arguments[1] ? pointRef(call.arguments[1]) : null;
        if (!aName || !bName) continue;
        const a = resolvePointRef(aName, pointEnv);
        const b = resolvePointRef(bName, pointEnv);
        if (!a || !b) continue;
        const basis = lineBasisFromEndpoints(a, b);
        env.set(decl.name.text, { ...basis, a, b });
        out.push({
          name: decl.name.text,
          kind: fnName,
          origin: basis.origin,
          dir: basis.dir,
          a,
          b,
        });
      } else if (fnName === "offsetLine") {
        const baseName = lineArgName(call.arguments[0]);
        const d = evalOffsetDistance(call.arguments[1], offsetEvals, distances);
        if (!baseName || d == null) continue;
        const base = env.get(baseName);
        if (!base) continue;
        const basis = offsetLineBasis(base, d);
        env.set(decl.name.text, basis);
        distances.set(decl.name.text, d);
        out.push({
          name: decl.name.text,
          kind: "offsetLine",
          origin: basis.origin,
          dir: basis.dir,
        });
      } else if (fnName === "perpendicularLine") {
        const baseName = lineArgName(call.arguments[0]);
        const throughName = call.arguments[1] ? pointRef(call.arguments[1]) : null;
        if (!baseName || !throughName) continue;
        const base = env.get(baseName);
        const through = resolvePointRef(throughName, pointEnv);
        if (!base || !through) continue;
        const pd = norm(perp(base.dir));
        env.set(decl.name.text, { origin: through, dir: pd });
        out.push({
          name: decl.name.text,
          kind: "line",
          origin: through,
          dir: pd,
        });
      }
    }
  }
  return out;
}

/** Evaluate named `const p = point(...)` and `lineIntersection(a, b)` in scene(). */
export function evalDerivedScenePoints(
  source: string,
  known: ReadonlyArray<{ name: string; x: number; y: number }>,
  offsetEvals?: ReadonlyMap<string, number>,
): { name: string; x: number; y: number }[] {
  const sf = parse(source);
  const fn = findSceneFunction(sf);
  if (!fn?.body) return [];
  const env = new Map<string, Vec2Like>();
  for (const k of known) env.set(k.name, { x: k.x, y: k.y });
  const lineEnv = new Map(
    evalSceneLines(source, env, offsetEvals).map((line) => [
      line.name,
      { origin: line.origin, dir: line.dir },
    ]),
  );
  const circles = new Map<string, { center: Vec2Like; radius: number }>();
  const out: { name: string; x: number; y: number }[] = [];
  for (const stmt of fn.body.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
      const call = unwrapCall(decl.initializer);
      if (!call || !ts.isIdentifier(call.expression)) continue;
      const fnName = call.expression.text;
      if (fnName === "point") {
        const ax = call.arguments[0];
        const ay = call.arguments[1];
        if (!ax || !ay) continue;
        const x = evalNumber(ax, env);
        const y = evalNumber(ay, env);
        if (x == null || y == null) continue;
        const bind = decl.name.text;
        env.set(bind, { x, y });
        if (known.some((k) => k.name === bind)) continue;
        out.push({ name: bind, x, y });
      } else if (fnName === "circle") {
        const cName = call.arguments[0] ? pointRef(call.arguments[0]) : null;
        const center = cName ? env.get(cName) : null;
        const radius = call.arguments[1] ? evalNumber(call.arguments[1], env) : null;
        if (!center || radius == null || !Number.isFinite(radius)) continue;
        circles.set(decl.name.text, { center, radius });
      } else if (fnName === "lineIntersection") {
        const aName = lineArgName(call.arguments[0]);
        const bName = lineArgName(call.arguments[1]);
        if (!aName || !bName) continue;
        const la = lineEnv.get(aName);
        const lb = lineEnv.get(bName);
        if (!la || !lb) continue;
        const p = lineIntersectionMath(la, lb);
        if (!p) continue;
        env.set(decl.name.text, p);
        out.push({ name: decl.name.text, x: p.x, y: p.y });
      } else if (fnName === "circleLineIntersection") {
        const cName = call.arguments[0] ? pointRef(call.arguments[0]) : null;
        const lName = lineArgName(call.arguments[1]);
        const k = call.arguments[2] ? numericLiteral(call.arguments[2]) : null;
        if (!cName || !lName || k == null) continue;
        const circ = circles.get(cName);
        const ln = lineEnv.get(lName);
        if (!circ || !ln) continue;
        const p = circleLineMath(circ, ln, k);
        if (!p) continue;
        env.set(decl.name.text, p);
        out.push({ name: decl.name.text, x: p.x, y: p.y });
      }
    }
  }
  return out;
}

export type SceneLineBinding = {
  name: string;
  kind: SceneLineBindingKind;
};

/** Closest named line binding whose evaluated geometry passes `matchFn`. */
export function namedSceneLineNear(
  source: string,
  drawableKind: SceneLineBindingKind,
  matchFn: (line: SceneLineEval) => boolean,
  pointEnv: ReadonlyMap<string, Vec2Like>,
  offsetEvals?: ReadonlyMap<string, number>,
): SceneLineBinding | null {
  const bindings = namedSceneLineBindings(source);
  const lines = evalSceneLines(source, pointEnv, offsetEvals);
  for (const line of lines) {
    if (bindings.get(line.name) !== drawableKind) continue;
    if (matchFn(line)) return { name: line.name, kind: line.kind };
  }
  return null;
}

/** Const name for a segment/line whose endpoints match within `maxDist`. */
export function resolveLineBindingName(
  source: string,
  segEndpoints: { a: Vec2Like; b: Vec2Like },
  pointEnv: ReadonlyMap<string, Vec2Like>,
  maxDist = 0.35,
): string | null {
  const { a, b } = segEndpoints;
  const matchEndpoints = (line: SceneLineEval): boolean => {
    if (!line.a || !line.b) return false;
    const direct =
      sqrt((line.a.x - a.x) * (line.a.x - a.x) + (line.a.y - a.y) * (line.a.y - a.y)) <= maxDist &&
      sqrt((line.b.x - b.x) * (line.b.x - b.x) + (line.b.y - b.y) * (line.b.y - b.y)) <= maxDist;
    const swapped =
      sqrt((line.a.x - b.x) * (line.a.x - b.x) + (line.a.y - b.y) * (line.a.y - b.y)) <= maxDist &&
      sqrt((line.b.x - a.x) * (line.b.x - a.x) + (line.b.y - a.y) * (line.b.y - a.y)) <= maxDist;
    return direct || swapped;
  };
  const hit = namedSceneLineNear(source, "segment", matchEndpoints, pointEnv);
  if (hit) return hit.name;
  const infinite = namedSceneLineNear(source, "line", matchEndpoints, pointEnv);
  return infinite?.name ?? null;
}

function arrayReturnElements(fn: ts.FunctionDeclaration): ts.ArrayLiteralExpression | null {
  const body = fn.body;
  if (!body) return null;
  const last = body.statements[body.statements.length - 1];
  if (!last || !ts.isReturnStatement(last) || !last.expression) return null;
  const retExpr = last.expression;
  return ts.isArrayLiteralExpression(retExpr) ? retExpr : null;
}

function sceneLineFromCall(
  call: ts.CallExpression,
  fnName: "segment" | "line",
  pointEnv: ReadonlyMap<string, Vec2Like>,
): SceneLineEval | null {
  const aName = call.arguments[0] ? pointRef(call.arguments[0]) : null;
  const bName = call.arguments[1] ? pointRef(call.arguments[1]) : null;
  if (!aName || !bName) return null;
  const a = resolvePointRef(aName, pointEnv);
  const b = resolvePointRef(bName, pointEnv);
  if (!a || !b) return null;
  const basis = lineBasisFromEndpoints(a, b);
  return {
    name: "",
    kind: fnName,
    origin: basis.origin,
    dir: basis.dir,
    a,
    b,
  };
}

/** Inline `segment(...)` / `line(...)` in `return [...]`. */
export function inlineSceneLineNear(
  source: string,
  drawableKind: "segment" | "line",
  matchFn: (line: SceneLineEval) => boolean,
  pointEnv: ReadonlyMap<string, Vec2Like>,
): { element: ts.Expression; kind: "segment" | "line" } | null {
  const sf = parse(source);
  const fn = findSceneFunction(sf);
  const arr = fn ? arrayReturnElements(fn) : null;
  if (!arr) return null;
  for (const el of arr.elements) {
    if (ts.isIdentifier(el)) continue;
    const call = unwrapCall(el);
    if (!call || !ts.isIdentifier(call.expression)) continue;
    const fnName = call.expression.text;
    if (fnName !== drawableKind) continue;
    const line = sceneLineFromCall(call, fnName, pointEnv);
    if (!line || !matchFn(line)) continue;
    return { element: el, kind: fnName };
  }
  return null;
}

function replaceArrayElementByText(
  source: string,
  fn: ts.FunctionDeclaration,
  exprText: string,
  replacement: string,
): string | null {
  const arr = arrayReturnElements(fn);
  if (!arr) return null;
  const sf = fn.getSourceFile();
  for (const el of arr.elements) {
    const text = source.slice(el.getStart(sf), el.getEnd());
    if (text === exprText) {
      return source.slice(0, el.getStart(sf)) + replacement + source.slice(el.getEnd());
    }
  }
  return null;
}

function promoteInlineElement(
  source: string,
  element: ts.Expression,
  kind: "segment" | "line",
): { source: string; name: string } {
  const sf = parse(source);
  const fn = findSceneFunction(sf);
  if (!fn) throw new Error("no scene()");
  const used = usedIdentifiers(sf);
  const prefix = kind === "line" ? "l" : "s";
  const name = freshName(prefix, used);
  const file = fn.getSourceFile();
  const exprText = source.slice(element.getStart(file), element.getEnd());
  const parent = element.parent;

  if (parent && ts.isExpressionStatement(parent)) {
    const next =
      source.slice(0, parent.getStart(file)) +
      `const ${name} = ${exprText};` +
      source.slice(parent.getEnd());
    return { source: next, name };
  }

  let next = insertSceneStatements(source, fn, [`const ${name} = ${exprText};`]);
  const fn2 = findSceneFunction(parse(next));
  if (!fn2) throw new Error("no scene()");
  const replaced = replaceArrayElementByText(next, fn2, exprText, name);
  if (!replaced) {
    throw new Error("That geometry has no construction site in scene().");
  }
  return { source: replaced, name };
}

/** Hoist a matching inline segment/line to `const` so offset can reference it. */
export function promoteInlineLineBinding(
  source: string,
  matchFn: (line: SceneLineEval) => boolean,
  pointEnv: ReadonlyMap<string, Vec2Like>,
): { source: string; name: string } | null {
  for (const kind of ["segment", "line"] as const) {
    const hit = inlineSceneLineNear(source, kind, matchFn, pointEnv);
    if (!hit) continue;
    return promoteInlineElement(source, hit.element, hit.kind);
  }
  return null;
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

const BINDING_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Non-empty scene binding names must be valid JS identifiers. */
export function isBindingName(raw: string | undefined): boolean {
  const t = raw?.trim() ?? "";
  return t !== "" && BINDING_NAME_RE.test(t);
}

/** User-facing error when a typed name is present but not a valid identifier. */
export function bindingNameError(raw: string | undefined): string | null {
  const t = raw?.trim() ?? "";
  if (t === "") return null;
  if (BINDING_NAME_RE.test(t)) return null;
  return "Name must start with a letter or underscore, then use only letters, digits, or underscores.";
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

export function nextBindingName(source: string, prefix: string): string {
  return freshName(prefix, usedIdentifiers(parse(source)));
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

/** First argument identifier of circle(...) at this site, if any. */
export function distanceOriginName(source: string, at: SourceAt): string | null {
  const sf = parse(source);
  const call = findEditCallAt(sf, at.line, at.column);
  if (!call) return null;
  const expr = call.expression;
  if (!ts.isIdentifier(expr) || expr.text !== "circle") {
    return null;
  }
  const first = call.arguments[0];
  if (!first || !ts.isIdentifier(first)) return null;
  return first.text;
}

function lineStartAt(source: string, pos: number): number {
  return source.lastIndexOf("\n", pos - 1) + 1;
}

function insertSceneStatements(source: string, fn: ts.FunctionDeclaration, lines: string[]): string {
  const body = fn.body;
  if (!body) throw new Error("scene() has no body");
  const stmts = body.statements;
  const last = stmts[stmts.length - 1];
  const sf = fn.getSourceFile();
  const indent = last ? indentAt(source, last.getStart(sf)) : "  ";
  const chunk = lines.map((ln) => `${indent}${ln}\n`).join("");
  if (last && ts.isReturnStatement(last)) {
    const lineStart = lineStartAt(source, last.getStart(sf));
    return source.slice(0, lineStart) + chunk + source.slice(lineStart);
  }
  const close = body.getEnd() - 1;
  const before = source.slice(0, close);
  const prefix = before.endsWith("\n") ? "" : "\n";
  return before + prefix + chunk + source.slice(close);
}

function bindPointRef(
  ref: PointRef,
  constLines: string[],
  used: Set<string>,
  geomImports: Set<string>,
): string {
  if ("name" in ref) return ref.name;
  geomImports.add("point");
  const name = freshName("p", used);
  constLines.push(`const ${name} = point(${formatNum(ref.x)}, ${formatNum(ref.y)});`);
  return name;
}

function pushRectFromCornerPoints(
  a: string,
  b: string,
  constLines: string[],
  used: Set<string>,
  geomImports: Set<string>,
): void {
  geomImports.add("point");
  geomImports.add("segment");
  const bl = freshName("bl", used);
  const tr = freshName("tr", used);
  const tl = freshName("tl", used);
  const br = freshName("br", used);
  constLines.push(
    `const ${bl} = point(Math.min(${a}.x, ${b}.x), Math.min(${a}.y, ${b}.y));`,
  );
  constLines.push(
    `const ${tr} = point(Math.max(${a}.x, ${b}.x), Math.max(${a}.y, ${b}.y));`,
  );
  constLines.push(`const ${tl} = point(${bl}.x, ${tr}.y);`);
  constLines.push(`const ${br} = point(${tr}.x, ${bl}.y);`);
  constLines.push(
    `segment(${bl}, ${tl});`,
    `segment(${tl}, ${tr});`,
    `segment(${tr}, ${br});`,
    `segment(${br}, ${bl});`,
  );
}

export function insertEditors(source: string, edits: EditorInsert[]): string {
  if (edits.length === 0) return source;

  const geomImports = new Set<string>();
  const euclidImports = new Set<string>();
  const constLines: string[] = [];

  const used = usedIdentifiers(parse(source));
  let lastPoint: string | undefined;

  for (const e of edits) {
    switch (e.kind) {
      case "point": {
        geomImports.add("point");
        const name = freshName("p", used);
        lastPoint = name;
        constLines.push(`const ${name} = point(${formatNum(e.x)}, ${formatNum(e.y)});`);
        break;
      }
      case "distance": {
        geomImports.add("circle");
        const origin = e.originName ?? lastPoint;
        if (!origin) {
          throw new Error("distance needs a point in scene() or a new point first");
        }
        const name = freshName("d", used);
        constLines.push(`const ${name} = circle(${origin}, ${formatNum(e.d)});`);
        break;
      }
      case "circle": {
        geomImports.add("circle");
        const center = bindPointRef(e.center, constLines, used, geomImports);
        if ("radius" in e) {
          constLines.push(`circle(${center}, ${e.radius});`);
        } else {
          constLines.push(`circle(${center}, ${formatNum(e.r)});`);
        }
        break;
      }
      case "segment": {
        geomImports.add("segment");
        const a = bindPointRef(e.a, constLines, used, geomImports);
        const b = bindPointRef(e.b, constLines, used, geomImports);
        constLines.push(`segment(${a}, ${b});`);
        break;
      }
      case "infiniteLine": {
        geomImports.add("line");
        const a = bindPointRef(e.a, constLines, used, geomImports);
        const b = bindPointRef(e.b, constLines, used, geomImports);
        constLines.push(`line(${a}, ${b});`);
        break;
      }
      case "intersection": {
        geomImports.add("lineIntersection");
        constLines.push(`lineIntersection(${e.a}, ${e.b});`);
        break;
      }
      case "rect": {
        const a = bindPointRef(e.a, constLines, used, geomImports);
        const b = bindPointRef(e.b, constLines, used, geomImports);
        pushRectFromCornerPoints(a, b, constLines, used, geomImports);
        break;
      }
      case "offsetFirst": {
        geomImports.add("offsetLine");
        const off = freshName("off", used);
        constLines.push(`const ${off} = offsetLine(${e.base}, ${formatNum(e.d)});`);
        break;
      }
      case "offsetReuse": {
        geomImports.add("offsetLine");
        constLines.push(`offsetLine(${e.base}, ${e.inset});`);
        break;
      }
    }
  }

  if (constLines.length === 0 && geomImports.size === 0 && euclidImports.size === 0) return source;

  let next = source;
  if (geomImports.size > 0) {
    next = ensureNamedImport(next, "@design-scenes/geom", [...geomImports].toSorted());
  }
  if (euclidImports.size > 0) {
    next = ensureNamedImport(next, "@design-scenes/euclid2", [...euclidImports].toSorted());
  }

  const sf = parse(next);
  const fn = findSceneFunction(sf);
  if (!fn) throw new Error("no exported scene() function to insert into");

  if (constLines.length > 0) {
    next = insertSceneStatements(next, fn, constLines);
  }

  return next;
}

export type ScenePatch = {
  hoistAt?: SourceAt[];
  imports?: Record<string, string[]>;
  statements?: string[];
  exprs?: string[];
};

const LINE_CALL_NAMES = new Set(["segment", "line", "offsetLine", "perpendicularLine"]);

export function bindLineAt(
  source: string,
  at: SourceAt,
): { source: string; name: string } | null {
  const sf = parse(source);
  const call = findIdentifierCallAt(sf, at.line, at.column, (n) => LINE_CALL_NAMES.has(n));
  if (!call || !ts.isIdentifier(call.expression)) return null;
  let n: ts.Node = call.parent;
  while (ts.isAsExpression(n) || ts.isParenthesizedExpression(n) || ts.isSatisfiesExpression(n)) {
    n = n.parent;
  }
  if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name)) {
    return { source, name: n.name.text };
  }
  const fnName = call.expression.text;
  const kind = fnName === "segment" ? "segment" : "line";
  return promoteInlineElement(source, call, kind);
}

export function editCallArgText(source: string, at: SourceAt, argIndex: number): string | null {
  const sf = parse(source);
  const call = findEditCallAt(sf, at.line, at.column);
  if (!call) return null;
  const arg = call.arguments[argIndex];
  if (!arg) return null;
  return source.slice(arg.getStart(sf), arg.getEnd());
}

export function applyScenePatch(source: string, patch: ScenePatch): string {
  let next = source;
  for (const at of patch.hoistAt ?? []) {
    const hoisted = bindLineAt(next, at);
    if (!hoisted) throw new Error(`no scene line at ${at.line}:${at.column}`);
    next = hoisted.source;
  }
  for (const [mod, names] of Object.entries(patch.imports ?? {})) {
    if (names.length > 0) next = ensureNamedImport(next, mod, [...new Set(names)]);
  }
  if (patch.statements && patch.statements.length > 0) {
    const fn = findSceneFunction(parse(next));
    if (!fn) throw new Error("no exported scene() function to insert into");
    next = insertSceneStatements(next, fn, patch.statements);
  }
  if (patch.exprs && patch.exprs.length > 0) {
    const fn = findSceneFunction(parse(next));
    if (!fn) throw new Error("no exported scene() function to insert into");
    const lines = patch.exprs.map((e) => (e.trimEnd().endsWith(";") ? e : `${e};`));
    next = insertSceneStatements(next, fn, lines);
  }
  return next;
}
