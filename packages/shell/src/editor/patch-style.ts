import * as ts from "typescript";

import type { LineStyle, ObjectStyle, PointStyle } from "../types.ts";
import { isSiteCall } from "./call-sites.ts";
import { findIdentifierCallAt, formatNum } from "./patch-widget.ts";

function parse(source: string): ts.SourceFile {
  return ts.createSourceFile("scene.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function printStyle(style: ObjectStyle): string {
  const parts: string[] = [];
  if (style.line) {
    const l = style.line;
    parts.push(
      `line: { color: ${JSON.stringify(l.color)}, width: ${formatNum(l.width)}, dash: ${JSON.stringify(l.dash)} }`,
    );
  }
  if (style.point) {
    const p = style.point;
    parts.push(
      `point: { color: ${JSON.stringify(p.color)}, size: ${formatNum(p.size)} }`,
    );
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

function printObject(
  sf: ts.SourceFile,
  obj: ts.ObjectLiteralExpression,
  style: ObjectStyle | null,
): string | null {
  const kept = obj.properties.filter((p) => propName(p) !== "style");
  const inner: string[] = kept.map((p) => p.getText(sf));
  if (style && (style.line || style.point)) {
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
  return (
    typeof o.color === "string" &&
    typeof o.width === "number" &&
    (o.dash === "solid" || o.dash === "dashed" || o.dash === "dotted")
  );
}

function isPointStyle(raw: unknown): raw is PointStyle {
  if (!raw || typeof raw !== "object") return false;
  const o = raw as Record<string, unknown>;
  return typeof o.color === "string" && typeof o.size === "number";
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
  const nextStyle = style && (style.line || style.point) ? style : null;

  if (last && ts.isObjectLiteralExpression(last)) {
    const printed = printObject(sf, last, nextStyle);
    if (printed == null) return removeLastArg(source, call);
    return replaceRange(source, last.getStart(sf), last.getEnd(), printed);
  }

  if (!nextStyle) return source;
  const close = call.getEnd() - 1;
  return replaceRange(source, close, close, `, { style: ${printStyle(nextStyle)} }`);
}
