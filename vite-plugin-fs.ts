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

function resolveWidgetIndex(
  sourceFile: ts.SourceFile,
  calls: ts.CallExpression[],
  raw: Record<string, unknown>,
): number | null {
  if (typeof raw.widgetIndex === "number") return raw.widgetIndex;
  if (typeof raw.index === "number") return raw.index;

  const site = raw.site;
  if (!site || typeof site !== "object") return null;
  const line = (site as { line?: unknown }).line;
  const column = (site as { column?: unknown }).column;
  const instance = (site as { instance?: unknown }).instance;
  if (typeof line !== "number") return null;

  const onLine = calls
    .map((call, idx) => {
      const pos = sourceFile.getLineAndCharacterOfPosition(call.getStart(sourceFile));
      return { idx, line: pos.line + 1, column: pos.character + 1 };
    })
    .filter((x) => x.line === line);

  if (onLine.length === 0) return null;

  if (typeof column === "number") {
    const exact = onLine.find((x) => x.column === column);
    if (exact) return exact.idx;
  }

  const n = typeof instance === "number" ? instance : 0;
  return onLine[n]?.idx ?? onLine[0]?.idx ?? null;
}

function patchWidget(
  source: string,
  widgetIndex: number,
  values: number[],
): string {
  const sourceFile = ts.createSourceFile(
    "scene.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const calls = collectEditCalls(sourceFile);
  const call = calls[widgetIndex];
  if (!call) {
    throw new Error(
      `widget ${widgetIndex} not found (${calls.length} edit* calls in file)`,
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
            const raw = JSON.parse(await readBody(req)) as Record<string, unknown>;
            const file = raw.file;
            const values = raw.values;

            if (
              typeof file !== "string" ||
              !Array.isArray(values) ||
              !values.every((v) => typeof v === "number")
            ) {
              json(res, 400, {
                ok: false,
                error: `invalid body: expected { file, widgetIndex, values:number[] }; got keys [${Object.keys(raw).join(", ")}]`,
              });
              return;
            }

            const abs = resolveUnder(SCENE_ROOT, path.basename(file));
            const source = fs.readFileSync(abs, "utf8");
            const sourceFile = ts.createSourceFile(
              "scene.ts",
              source,
              ts.ScriptTarget.Latest,
              true,
              ts.ScriptKind.TS,
            );
            const calls = collectEditCalls(sourceFile);
            const widgetIndex = resolveWidgetIndex(sourceFile, calls, raw);

            if (widgetIndex === null) {
              json(res, 400, {
                ok: false,
                error: `invalid body: need widgetIndex (hard refresh) or a site on an edit* line; got keys [${Object.keys(raw).join(", ")}]`,
              });
              return;
            }

            const next = patchWidget(source, widgetIndex, values as number[]);
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
