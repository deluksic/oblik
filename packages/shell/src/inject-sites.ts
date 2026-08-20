import * as ts from "typescript";
import { EDIT_NAMES } from "./edit-names.ts";

export type SiteMint = () => string;

function parse(source: string): ts.SourceFile {
  return ts.createSourceFile(
    "scene.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
}

function collectEditCalls(sourceFile: ts.SourceFile): ts.CallExpression[] {
  const calls: ts.CallExpression[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      EDIT_NAMES.has(node.expression.text)
    ) {
      calls.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return calls;
}

/**
 * Inject `{ id, at }` onto each edit* in compiled output. Source on disk is
 * unchanged. `at` is 1-based line/column of the CallExpression start.
 */
export function injectSceneSites(
  source: string,
  mint: SiteMint = () => crypto.randomUUID(),
): string {
  const sf = parse(source);
  const calls = collectEditCalls(sf);
  const splices: { start: number; text: string }[] = [];
  for (const call of calls) {
    const pos = sf.getLineAndCharacterOfPosition(call.getStart(sf));
    const line = pos.line + 1;
    const column = pos.character + 1;
    const id = mint();
    const last = call.arguments[call.arguments.length - 1];
    if (last && ts.isObjectLiteralExpression(last)) {
      splices.push({
        start: last.getStart(sf) + 1,
        text: ` id: ${JSON.stringify(id)}, at: [${line}, ${column}],`,
      });
    } else {
      splices.push({
        start: call.getEnd() - 1,
        text: `, { id: ${JSON.stringify(id)}, at: [${line}, ${column}] }`,
      });
    }
  }
  splices.sort((a, b) => b.start - a.start);
  let next = source;
  for (const s of splices) {
    next = next.slice(0, s.start) + s.text + next.slice(s.start);
  }
  return next;
}
