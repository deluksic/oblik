import * as ts from "typescript";

import type { LineStyle, ObjectStyle, PointStyle } from "../types.ts";
import { isSiteCall } from "./call-sites.ts";
import { findIdentifierCallAt, formatNum } from "./patch-widget.ts";

function parse(source: string): ts.SourceFile {
  return ts.createSourceFile("scene.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function printLineStyle(line: LineStyle): string {
  const parts: string[] = [];
  if (line.color !== undefined) parts.push(`color: ${JSON.stringify(line.color)}`);
  if (line.width !== undefined) parts.push(`width: ${formatNum(line.width)}`);
  if (line.dash !== undefined) parts.push(`dash: ${JSON.stringify(line.dash)}`);
  return `{ ${parts.join(", ")} }`;
}

function printPointStyle(point: PointStyle): string {
  const parts: string[] = [];
  if (point.color !== undefined) parts.push(`color: ${JSON.stringify(point.color)}`);
  if (point.size !== undefined) parts.push(`size: ${formatNum(point.size)}`);
  return `{ ${parts.join(", ")} }`;
}

function printStyle(style: ObjectStyle): string {
  const parts: string[] = [];
  if (style.line && (style.line.color !== undefined || style.line.width !== undefined || style.line.dash !== undefined)) {
    parts.push(`line: ${printLineStyle(style.line)}`);
  }
  if (style.point && (style.point.color !== undefined || style.point.size !== undefined)) {
    parts.push(`point: ${printPointStyle(style.point)}`);
  }
  return `{ ${parts.join(", ")} }`;
}

function propName(p: ts.ObjectLiteralElementLike): string | undefined {
  if (
    (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) &&
    ts.isIdentifier(p.name)
  ) {
    return p.name.text;
  }
  return undefined;
}

function replaceRange(source: string, start: number, end: number, text: string): string {
  return source.slice(0, start) + text + source.slice(end);
}

function hasStoredStyle(style: ObjectStyle | null): boolean {
  if (!style) return false;
  const line = style.line;
  const point = style.point;
  return !!(
    (line && (line.color !== undefined || line.width !== undefined || line.dash !== undefined)) ||
    (point && (point.color !== undefined || point.size !== undefined))
  );
}

function printObject(
  sf: ts.SourceFile,
  obj: ts.ObjectLiteralExpression,
  style: ObjectStyle | null,
): string | null {
  const kept = obj.properties.filter((p) => propName(p) !== "style");
  const inner: string[] = kept.map((p) => p.getText(sf));
  if (style && hasStoredStyle(style)) {
    inner.push(`style: ${printStyle(style)}`);
  }
  if (inner.length === 0) return null;
  return `{ ${inner.join(", ")} }`;
}

function removeLastArg(source: string, call: ts.CallExpression): string {
  const last = call.arguments[call.arguments.length - 1];
  if (!last) return source;
  const prev = call.arguments[call.arguments.length - 2];
  const start = prev ? prev.getEnd() : last.getFullStart();
  return replaceRange(source, start, last.getEnd(), "");
}

function isLineStyle(raw: unknown): raw is LineStyle {
  if (!raw || typeof raw !== "object") return false;
  const o = raw as Record<string, unknown>;
  if (o.color !== undefined && typeof o.color !== "string") return false;
  if (o.width !== undefined && typeof o.width !== "number") return false;
  if (
    o.dash !== undefined &&
    o.dash !== "solid" &&
    o.dash !== "dashed" &&
    o.dash !== "dotted"
  ) {
    return false;
  }
  return o.color !== undefined || o.width !== undefined || o.dash !== undefined;
}

function isPointStyle(raw: unknown): raw is PointStyle {
  if (!raw || typeof raw !== "object") return false;
  const o = raw as Record<string, unknown>;
  if (o.color !== undefined && typeof o.color !== "string") return false;
  if (o.size !== undefined && typeof o.size !== "number") return false;
  return o.color !== undefined || o.size !== undefined;
}

/** `null` clears style. `undefined` means the payload was invalid. */
export function parseObjectStyle(raw: unknown): ObjectStyle | null | undefined {
  if (raw === null) return null;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  const out: ObjectStyle = {};
  if (o.line !== undefined) {
    if (!isLineStyle(o.line)) return undefined;
    out.line = o.line;
  }
  if (o.point !== undefined) {
    if (!isPointStyle(o.point)) return undefined;
    out.point = o.point;
  }
  if (!hasStoredStyle(out)) return null;
  return out;
}

/** Rewrite `{ style }` on the site call at line:column. `null` removes it. */
export function patchStyleAt(
  source: string,
  line: number,
  column: number,
  style: ObjectStyle | null,
): string {
  const sf = parse(source);
  const call = findIdentifierCallAt(sf, line, column, isSiteCall);
  if (!call) {
    throw new Error(`no constructor call at ${line}:${column}`);
  }
  const last = call.arguments[call.arguments.length - 1];
  const nextStyle = style && hasStoredStyle(style) ? style : null;

  if (last && ts.isObjectLiteralExpression(last)) {
    const printed = printObject(sf, last, nextStyle);
    if (printed == null) return removeLastArg(source, call);
    return replaceRange(source, last.getStart(sf), last.getEnd(), printed);
  }

  if (!nextStyle) return source;
  const close = call.getEnd() - 1;
  return replaceRange(source, close, close, `, { style: ${printStyle(nextStyle)} }`);
}
