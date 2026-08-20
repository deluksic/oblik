import fs from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import * as ts from "typescript";
import type { Plugin } from "vite";

const SRC_ROOT = path.resolve("src");
const SCENE_ROOT = path.resolve("src/scenes");
const EDIT_NAMES = new Set([
  "editPoint",
  "editDistanceToPoint",
  "editPointOnLine",
]);

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function resolveUnder(root: string, rel: string): string {
  const abs = path.resolve(root, path.normalize(rel));
  if (!abs.startsWith(root + path.sep) && abs !== root) {
    throw new Error("path escapes sandbox");
  }
  return abs;
}

function formatNum(n: number): string {
  const q = Math.round(n * 100) / 100;
  if (Object.is(q, -0)) return "0";
  return String(q);
}

function numericSpan(
  sourceFile: ts.SourceFile,
  expr: ts.Expression,
): { start: number; end: number } | null {
  if (ts.isNumericLiteral(expr)) {
    return { start: expr.getStart(sourceFile), end: expr.getEnd() };
  }
  if (
    ts.isPrefixUnaryExpression(expr) &&
    expr.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(expr.operand)
  ) {
    return { start: expr.getStart(sourceFile), end: expr.getEnd() };
  }
  return null;
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

function findEditCall(
  sourceFile: ts.SourceFile,
  calls: ts.CallExpression[],
  line: number,
  column: number,
): ts.CallExpression | undefined {
  for (const call of calls) {
    const pos = sourceFile.getLineAndCharacterOfPosition(call.getStart(sourceFile));
    if (pos.line + 1 === line && pos.character + 1 === column) return call;
  }
  let best: ts.CallExpression | undefined;
  let bestDist = Infinity;
  for (const call of calls) {
    const pos = sourceFile.getLineAndCharacterOfPosition(call.getStart(sourceFile));
    if (pos.line + 1 !== line) continue;
    const dist = Math.abs(pos.character + 1 - column);
    if (dist < bestDist) {
      bestDist = dist;
      best = call;
    }
  }
  return best;
}

function patchWidget(
  source: string,
  site: { line: number; column: number; instance: number },
  values: number[],
): string {
  if (site.instance > 0) {
    throw new Error(
      `edit* at ${site.line}:${site.column} was invoked ${site.instance + 1} times this frame but the scene has one literal — unroll or duplicate the call in the scene file`,
    );
  }
  const sourceFile = ts.createSourceFile(
    "scene.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const calls = collectEditCalls(sourceFile);
  const call = findEditCall(sourceFile, calls, site.line, site.column);
  if (!call) {
    throw new Error(
      `edit* at ${site.line}:${site.column} not found (${calls.length} edit* calls in file)`,
    );
  }

  const name = (call.expression as ts.Identifier).text;
  const spans: { start: number; end: number; text: string }[] = [];

  if (name === "editPoint") {
    const x = call.arguments[0];
    const y = call.arguments[1];
    if (!x || !y) throw new Error("editPoint expects two arguments");
    const sx = numericSpan(sourceFile, x);
    const sy = numericSpan(sourceFile, y);
    if (!sx || !sy) {
      throw new Error("editPoint args are not numeric literals");
    }
    if (values[0] === undefined || values[1] === undefined) {
      throw new Error("editPoint write needs two values");
    }
    spans.push({ ...sx, text: formatNum(values[0]) });
    spans.push({ ...sy, text: formatNum(values[1]) });
  } else {
    const last = call.arguments[call.arguments.length - 1];
    if (!last) throw new Error(`${name} missing argument`);
    const span = numericSpan(sourceFile, last);
    if (!span) throw new Error(`${name} last arg is not a numeric literal`);
    if (values[0] === undefined) throw new Error(`${name} write needs a value`);
    spans.push({ ...span, text: formatNum(values[0]) });
  }

  spans.sort((a, b) => b.start - a.start);
  let next = source;
  for (const s of spans) {
    next = next.slice(0, s.start) + s.text + next.slice(s.end);
  }
  return next;
}

function sendText(res: ServerResponse, text: string) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end(text);
}

export function fsBridgePlugin(): Plugin {
  return {
    name: "fs-bridge",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url?.split("?")[0] ?? "";
        try {
          if (url === "/__write-widget" && req.method === "POST") {
            const body = JSON.parse(await readBody(req)) as {
              file?: string;
              site?: { line: number; column: number; instance: number };
              values?: number[];
            };
            if (
              typeof body.file !== "string" ||
              !body.site ||
              typeof body.site.line !== "number" ||
              typeof body.site.column !== "number" ||
              typeof body.site.instance !== "number" ||
              !Array.isArray(body.values)
            ) {
              json(res, 400, { ok: false, error: "invalid body" });
              return;
            }
            const abs = resolveUnder(SCENE_ROOT, path.basename(body.file));
            const source = fs.readFileSync(abs, "utf8");
            const next = patchWidget(source, body.site, body.values);
            fs.writeFileSync(abs, next);
            json(res, 200, { ok: true });
            return;
          }

          if (url === "/__peek" && req.method === "GET") {
            const u = new URL(req.url ?? "", "http://127.0.0.1");
            const file = u.searchParams.get("file") ?? "";
            const rel = file.replace(/^\/+/, "");
            const abs = resolveUnder(SRC_ROOT, rel.replace(/^src\//, ""));
            if (!fs.existsSync(abs)) {
              json(res, 404, { ok: false, error: "not found" });
              return;
            }
            sendText(res, fs.readFileSync(abs, "utf8"));
            return;
          }
        } catch (err) {
          json(res, 500, {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
          return;
        }
        next();
      });
    },
  };
}
