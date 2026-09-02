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
      const { id } = trailingId(node);
      if (!id) {
        const fresh = nextId();
        added.push(fresh);
        const insertAt = node.getEnd() - 1;
        const needsComma = node.arguments.length > 0;
        ms.appendLeft(insertAt, `${needsComma ? ", " : ""}"${fresh}"`);
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
