import MagicString from "magic-string";
import * as ts from "typescript";

import { trailingId } from "./analyze";
import { formatNum } from "./patch";

/** Every leaf a patch may set, as a dotted path into the options object. */
export const IMAGE_LEAVES = [
  "world.x",
  "world.y",
  "anchor.x",
  "anchor.y",
  "imageSize.width",
  "imageSize.height",
  "targetSize.width",
  "targetSize.height",
  "rot",
  "flip",
  "style.opacity",
  "style.saturation",
  "style.contrast",
] as const;

export type ImageLeaf = (typeof IMAGE_LEAVES)[number];

/** A patch as it arrives on the wire: plain values at dotted leaves. `src` is
 * the call's first argument rather than a prop, so it travels beside them. */
export type ImageProps = Partial<Record<ImageLeaf, number>> & { src?: string };

/** A subtree being assembled for a missing branch: printed values at the leaves. */
type Tree = string | { [key: string]: Tree };

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

/** Named properties of an options object, so a patch can tell what it overwrites
 * and what it has to create. Shorthand counts: `{ x, y }` has both, and a patch
 * replaces the whole property because there is no initializer to write. */
function propsOf(obj: ts.ObjectLiteralExpression): Map<string, ts.ObjectLiteralElementLike> {
  const out = new Map<string, ts.ObjectLiteralElementLike>();
  for (const p of obj.properties) {
    if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name)) out.set(p.name.text, p);
    else if (ts.isShorthandPropertyAssignment(p)) out.set(p.name.text, p);
  }
  return out;
}

function printTree(tree: Tree): string {
  if (typeof tree === "string") return tree;
  const parts = Object.entries(tree).map(([key, value]) => `${key}: ${printTree(value)}`);
  return `{ ${parts.join(", ")} }`;
}

/**
 * Add dotted entries to an object literal in the style it is already written in:
 * one property per line when multiline, `{ a: 1 }` when single-line.
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

/** Record `path: value` under the object it is missing from, so that every
 * creation inside one object becomes a single inserted property tree rather than
 * one insert per leaf — which would emit the same parent twice. */
function addPending(
  pending: Map<ts.ObjectLiteralExpression, Tree>,
  obj: ts.ObjectLiteralExpression,
  path: readonly string[],
  value: string,
): void {
  const existing = pending.get(obj);
  const tree: { [key: string]: Tree } = existing && typeof existing !== "string" ? existing : {};
  pending.set(obj, tree);
  let node = tree;
  for (const key of path.slice(0, -1)) {
    const next = node[key];
    if (typeof next !== "object") node[key] = {};
    node = node[key] as { [key: string]: Tree };
  }
  node[path[path.length - 1]!] = value;
}

/** Write one leaf, descending through the objects on the way and recording the
 * branch it has to create. Returns nothing: every leaf it is given is a write. */
function setLeaf(
  ms: MagicString,
  sf: ts.SourceFile,
  obj: ts.ObjectLiteralExpression,
  path: readonly string[],
  value: string,
  pending: Map<ts.ObjectLiteralExpression, Tree>,
): void {
  const head = path[0]!;
  const rest = path.slice(1);
  const prop = propsOf(obj).get(head);
  if (rest.length === 0) {
    if (!prop) {
      addPending(pending, obj, [head], value);
      return;
    }
    // A shorthand property (`{ x, y }`) has no initializer to write, so the whole
    // property becomes a named one — never a bare value in its place.
    const shorthand = !ts.isPropertyAssignment(prop);
    const target = shorthand ? prop : prop.initializer;
    ms.overwrite(target.getStart(sf), target.getEnd(), shorthand ? `${head}: ${value}` : value);
    return;
  }
  if (!prop) {
    addPending(pending, obj, path, value);
    return;
  }
  const init = ts.isPropertyAssignment(prop) ? prop.initializer : undefined;
  if (!init || !ts.isObjectLiteralExpression(init)) {
    throw new Error(`image(..., { ${head}: … }) is not an object literal to patch`);
  }
  setLeaf(ms, sf, init, rest, value, pending);
}

/**
 * Patch a reference in place: leaves the call carries are overwritten, missing
 * ones created, so the inspector can move or resize a node that states little.
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
    ms.overwrite(arg.getStart(sf), arg.getEnd(), JSON.stringify(props.src));
    wrote++;
  }

  const leaves = IMAGE_LEAVES.filter((leaf) => props[leaf] !== undefined);
  if (leaves.length > 0) {
    const optsArg = args[1];
    if (!optsArg || !ts.isObjectLiteralExpression(optsArg)) {
      throw new Error(`image("${id}") has no options object to patch`);
    }
    const pending = new Map<ts.ObjectLiteralExpression, Tree>();
    for (const leaf of leaves) {
      setLeaf(ms, sf, optsArg, leaf.split("."), formatNum(props[leaf]!), pending);
      wrote++;
    }
    for (const [obj, tree] of pending) {
      const entries = Object.entries(tree).map(([key, value]) => `${key}: ${printTree(value)}`);
      insertProps(ms, source, sf, obj, entries);
    }
  }

  if (wrote === 0) throw new Error(`image("${id}") patch has no props`);
  return ms.toString();
}
