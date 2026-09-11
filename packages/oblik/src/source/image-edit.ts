import MagicString from "magic-string";
import * as ts from "typescript";

import type { ImageValue } from "../eval/image";
import { trailingId } from "./analyze";
import { formatNum } from "./patch";

/** Any subset of the node's props; an absent key leaves that argument alone. */
export type ImageProps = Partial<Omit<ImageValue, "kind">>;

/** The call's argument order, which is also how a prop maps to an argument index. */
const ARG_ORDER = ["src", "x", "y", "w", "h", "rot", "flip", "fade"] as const;

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

function printArg(key: (typeof ARG_ORDER)[number], value: string | number): string {
  // `props[key]` is not correlated with `key` by the checker, so the non-`src`
  // branch states the number it already is.
  return key === "src" ? JSON.stringify(value) : formatNum(value as number);
}

/**
 * Rewrite the named arguments of `image(…, "<id>")`, leaving everything else in
 * the call — and the rest of the file — byte for byte. Per-argument rather than
 * whole-call so a scene that authored `x`/`y` as refs keeps them: only the props
 * the caller actually sends are overwritten.
 *
 * Throws when there is no such call, when a prop has no argument to land in, or
 * when the patch is empty — the caller turns that into an error response rather
 * than writing a half-edited file.
 */
export function patchImageProps(source: string, id: string, props: ImageProps): string {
  const sf = parse(source);
  const call = imageCallWithId(sf, id);
  if (!call) throw new Error(`no image(..., "${id}")`);
  const { args } = trailingId(call);
  const ms = new MagicString(source);
  let wrote = 0;
  for (let i = 0; i < ARG_ORDER.length; i++) {
    const key = ARG_ORDER[i]!;
    const value = props[key];
    if (value === undefined) continue;
    const arg = args[i];
    if (!arg) throw new Error(`image("${id}") has no ${key} argument`);
    ms.overwrite(arg.getStart(sf), arg.getEnd(), printArg(key, value));
    wrote++;
  }
  if (wrote === 0) throw new Error(`image("${id}") patch has no props`);
  return ms.toString();
}
