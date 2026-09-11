import MagicString from "magic-string";
import * as ts from "typescript";

import type { ImageOpts } from "../eval/image";
import { trailingId } from "./analyze";
import { formatNum } from "./patch";

/** Any subset of a reference's fields; an absent key is left alone. The source
 * is a separate argument in the call, so it patches separately too. */
export type ImageProps = Partial<ImageOpts> & { src?: string };

/** The props object's field order, used when a property has to be inserted. */
const PROP_ORDER = ["x", "y", "w", "h", "rot", "flip", "fade"] as const;

type PropKey = (typeof PROP_ORDER)[number];

function parse(source: string): ts.SourceFile {
  return ts.createSourceFile("scene.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function imageCallWithId(sf: ts.SourceFile, id: string): ts.CallExpression | undefined {
  let found: ts.CallExpression | undefined;
  const visit = (node: ts.Node) => {
    if (found) return;
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "image" &&
      trailingId(node).id === id
    ) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

function printValue(value: string | number): string {
  return typeof value === "string" ? JSON.stringify(value) : formatNum(value);
}

/** Every named property of the options object, so a patch can find the ones to
 * overwrite. Shorthand counts: `{ x, y, w, h }` patches `x` by replacing the
 * whole property, since there is no initializer to write. */
function propsOf(obj: ts.ObjectLiteralExpression): Map<string, ts.ObjectLiteralElementLike> {
  const out = new Map<string, ts.ObjectLiteralElementLike>();
  for (const p of obj.properties) {
    if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name)) out.set(p.name.text, p);
    else if (ts.isShorthandPropertyAssignment(p)) out.set(p.name.text, p);
  }
  return out;
}

/**
 * Add `entries` (`["fade: 0.4"]`) to the options object, in the style the object
 * is already written in: a multiline object gets one property per line, indented
 * like its last property, and a single-line one is extended in place. Trailing
 * commas are respected rather than doubled — the same care `stamp.ts` takes when
 * it appends an id.
 */
function insertProps(
  ms: MagicString,
  source: string,
  sf: ts.SourceFile,
  obj: ts.ObjectLiteralExpression,
  entries: string[],
): void {
  const closeBrace = obj.getEnd() - 1;
  const last = obj.properties[obj.properties.length - 1];
  if (!last) {
    // `{}` (or `{ }`) becomes `{ x: 1, y: 2 }`, the house style for a literal.
    ms.remove(obj.getStart(sf) + 1, closeBrace);
    ms.appendLeft(closeBrace, ` ${entries.join(", ")} `);
    return;
  }
  const gapStart = last.getEnd();
  const gap = source.slice(gapStart, closeBrace);
  if (!gap.includes("\n")) {
    // Whatever sat between the last property and the brace — a trailing comma,
    // a space, neither — is replaced by one normalised separator.
    ms.remove(gapStart, closeBrace);
    ms.appendLeft(closeBrace, `, ${entries.join(", ")} `);
    return;
  }
  const anchorStart = last.getStart(sf);
  const linePrefix = source.slice(source.lastIndexOf("\n", anchorStart) + 1, anchorStart);
  const indent = /^[ \t]*/.exec(linePrefix)?.[0] ?? "";
  let closeWs = closeBrace;
  while (closeWs > gapStart && (source[closeWs - 1] === " " || source[closeWs - 1] === "\t"))
    closeWs--;
  ms.remove(gapStart, closeWs);
  const trailing = gap.trimStart().startsWith(",") ? "," : "";
  ms.appendLeft(closeWs, `,\n${indent}${entries.join(`,\n${indent}`)}${trailing}\n`);
}

/**
 * Patch a reference's props in place. Properties that are already in the call
 * are overwritten; ones it does not carry yet are inserted, so an inspector can
 * fade a node the author wrote as `image(src, { x, y, w, h })` without touching
 * the source by hand. `src` is rewritten as the call's first argument.
 *
 * Throws when there is no such call, when the props argument is not an object
 * literal (a ref cannot be patched field by field), or when the patch is empty —
 * the caller turns that into an error response rather than writing half a file.
 */
export function patchImageProps(source: string, id: string, props: ImageProps): string {
  const sf = parse(source);
  const call = imageCallWithId(sf, id);
  if (!call) throw new Error(`no image(..., "${id}")`);
  const { args } = trailingId(call);
  const ms = new MagicString(source);
  let wrote = 0;

  if (props.src !== undefined) {
    const arg = args[0];
    if (!arg) throw new Error(`image("${id}") has no src argument`);
    ms.overwrite(arg.getStart(sf), arg.getEnd(), printValue(props.src));
    wrote++;
  }

  const fields = PROP_ORDER.filter((key) => props[key] !== undefined);
  if (fields.length > 0) {
    const optsArg = args[1];
    if (!optsArg || !ts.isObjectLiteralExpression(optsArg)) {
      throw new Error(`image("${id}") has no options object to patch`);
    }
    const existing = propsOf(optsArg);
    const missing: PropKey[] = [];
    for (const key of fields) {
      const text = printValue(props[key] as string | number);
      const prop = existing.get(key);
      if (!prop) {
        missing.push(key);
        continue;
      }
      // A shorthand property (`{ x, y }`) has no initializer to write, so the
      // whole property becomes a named one — never a bare `7` in its place.
      const shorthand = !ts.isPropertyAssignment(prop);
      const target = shorthand ? prop : prop.initializer;
      ms.overwrite(target.getStart(sf), target.getEnd(), shorthand ? `${key}: ${text}` : text);
      wrote++;
    }
    if (missing.length > 0) {
      insertProps(
        ms,
        source,
        sf,
        optsArg,
        missing.map((key) => `${key}: ${printValue(props[key] as string | number)}`),
      );
      wrote += missing.length;
    }
  }

  if (wrote === 0) throw new Error(`image("${id}") patch has no props`);
  return ms.toString();
}
