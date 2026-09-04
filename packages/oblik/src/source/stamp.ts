import MagicString from "magic-string";
import * as ts from "typescript";

import { siteSpecs, trailingId } from "./analyze";

function parse(source: string): ts.SourceFile {
  return ts.createSourceFile("scene.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

export function freshSiteId(): string {
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  return `o_${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export function stamp(
  source: string,
  nextId: () => string = freshSiteId,
  file = "scene.ts",
): {
  source: string;
  added: string[];
  map: { mappings: string; names: string[]; sources: string[]; version: 3 };
} {
  const specs = siteSpecs();
  const sf = parse(source);
  const ms = new MagicString(source);
  const added: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      specs.has(node.expression.text)
    ) {
      const last = node.arguments[node.arguments.length - 1];
      if (last && ts.isStringLiteral(last) && last.text === "") {
        // Copy-pasted leftover: the id slot still has its empty quotes. Fill
        // them with a fresh id instead of appending a second trailing arg.
        const fresh = nextId();
        added.push(fresh);
        const quote = source.charAt(last.getStart(sf)) === "'" ? "'" : '"';
        ms.overwrite(last.getStart(sf), last.getEnd(), `${quote}${fresh}${quote}`);
      } else {
        const { id } = trailingId(node);
        if (!id) {
          const fresh = nextId();
          added.push(fresh);
          const insertAt = node.getEnd() - 1;
          const last = node.arguments[node.arguments.length - 1];
          const needsComma = node.arguments.length > 0;
          const gapStart = last ? last.getEnd() : node.expression.getEnd() + 1;
          const gap = source.slice(gapStart, insertAt);
          const hasTrailingComma = gap.trimStart().startsWith(",");
          if (gap.includes("\n")) {
            // Multiline call: `)` sits on its own line, so appending before it
            // would produce a stray `, "id")` or a doubled comma. Give the id
            // its own argument line instead, indented like the last argument.
            const anchor = last ?? node.expression;
            const anchorStart = anchor.getStart(sf);
            const anchorPrefix = source.slice(
              source.lastIndexOf("\n", anchorStart) + 1,
              anchorStart,
            );
            const base = anchorPrefix.match(/^[ \t]*/)![0];
            const indent = last ? base : `${base}  `;
            let closeWsStart = insertAt;
            while (
              closeWsStart > gapStart &&
              (source[closeWsStart - 1] === " " || source[closeWsStart - 1] === "\t")
            ) {
              closeWsStart--;
            }
            ms.remove(gapStart, closeWsStart);
            ms.appendLeft(
              closeWsStart,
              `${needsComma ? "," : ""}\n${indent}"${fresh}"${hasTrailingComma ? "," : ""}\n`,
            );
          } else if (hasTrailingComma) {
            ms.appendLeft(insertAt, ` "${fresh}"`);
          } else {
            ms.appendLeft(insertAt, `${needsComma ? ", " : ""}"${fresh}"`);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  const map = ms.generateMap({ hires: true, includeContent: true, source: file }) as {
    mappings: string;
    names: string[];
    sources: string[];
    version: 3;
  };
  return { source: ms.toString(), added, map };
}
