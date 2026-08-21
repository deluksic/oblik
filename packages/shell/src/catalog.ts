import path from "node:path";

import * as ts from "typescript";

import { isSceneId, layoutFromIds, normalizeAreas } from "./layout-grid.ts";
import { VIEW_KINDS, type SceneEntry, type SceneLayout, type ViewKind } from "./types.ts";

function unwrap(expr: ts.Expression): ts.Expression {
  if (ts.isAsExpression(expr) || ts.isSatisfiesExpression(expr)) {
    return unwrap(expr.expression);
  }
  if (ts.isParenthesizedExpression(expr)) return unwrap(expr.expression);
  return expr;
}

function stringValue(expr: ts.Expression): string | undefined {
  const e = unwrap(expr);
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) {
    return e.text;
  }
  return undefined;
}

function propMap(expr: ts.Expression): Map<string, ts.Expression> | undefined {
  const e = unwrap(expr);
  if (!ts.isObjectLiteralExpression(e)) return undefined;
  const out = new Map<string, ts.Expression>();
  for (const p of e.properties) {
    if (!ts.isPropertyAssignment(p)) continue;
    const name = ts.isIdentifier(p.name)
      ? p.name.text
      : ts.isStringLiteral(p.name)
        ? p.name.text
        : undefined;
    if (name) out.set(name, p.initializer);
  }
  return out;
}

function parseLayout(expr: ts.Expression): SceneLayout | string {
  const e = unwrap(expr);
  const asString = stringValue(e);
  if (asString != null) return { areas: normalizeAreas(asString) };

  if (ts.isArrayLiteralExpression(e)) {
    const ids: string[] = [];
    for (const el of e.elements) {
      const id = stringValue(el);
      if (!id) return "layout array must be string scene ids";
      ids.push(id);
    }
    if (ids.length === 0) return "layout array is empty";
    return layoutFromIds(ids);
  }

  const obj = propMap(e);
  if (!obj) return "layout must be a string, string[], or { areas, columns?, rows? }";
  const areas = obj.get("areas");
  if (!areas) return "layout.areas is required";
  const areasText = stringValue(areas);
  if (areasText == null) return "layout.areas must be a string";
  const columns = obj.get("columns");
  const rows = obj.get("rows");
  const layout: SceneLayout = { areas: normalizeAreas(areasText) };
  if (columns) {
    const c = stringValue(columns);
    if (c == null) return "layout.columns must be a string";
    layout.columns = c;
  }
  if (rows) {
    const r = stringValue(rows);
    if (r == null) return "layout.rows must be a string";
    layout.rows = r;
  }
  return layout;
}

function isSceneFunction(node: ts.FunctionDeclaration): boolean {
  return (
    node.name?.text === "scene" &&
    node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) === true
  );
}

export function parseSceneSource(file: string, source: string): SceneEntry {
  const stem = file.endsWith(".scene.ts")
    ? path.basename(file, ".scene.ts")
    : path.basename(file, ".ts");
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

  let id = stem;
  let title: string | undefined;
  let view: ViewKind | undefined;
  let layout: SceneLayout | undefined;
  let layoutError: string | undefined;
  let hasScene = false;

  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt) && isSceneFunction(stmt)) hasScene = true;
    if (!ts.isVariableStatement(stmt)) continue;
    const exported = stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (!exported) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
      const name = decl.name.text;
      if (name === "id") {
        const v = stringValue(decl.initializer);
        if (v) id = v;
      } else if (name === "title") {
        title = stringValue(decl.initializer);
      } else if (name === "view") {
        const v = stringValue(decl.initializer);
        if (v && (VIEW_KINDS as readonly string[]).includes(v)) {
          view = v as ViewKind;
        }
      } else if (name === "layout") {
        const parsed = parseLayout(decl.initializer);
        if (typeof parsed === "string") layoutError = parsed;
        else layout = parsed;
      } else if (name === "scene") {
        hasScene = true;
      }
    }
  }

  const entry: SceneEntry = {
    id,
    file: path.basename(file),
    title: title ?? id,
    view: view ?? "euclid2",
    hasScene,
    layout,
  };

  if (!isSceneId(id)) {
    entry.error = `id "${id}" must match [a-z][a-z0-9-]* (CSS grid area name)`;
  } else if (layoutError) {
    entry.error = layoutError;
  } else if (layout && hasScene) {
    entry.error = "export either scene() or layout, not both";
  } else if (!layout && !hasScene) {
    entry.error = "missing scene() or layout";
  }
  return entry;
}
