import fs from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import * as ts from "typescript";
import type { Plugin } from "vite";

const EDIT_NAMES = new Set([
  "editPoint",
  "editPoint3",
  "editDistanceToPoint",
  "editDistance3",
  "editPointOnLine",
  "editPointOnLine3",
  "editNumber",
]);

export type SceneDevOptions = {
  /** Repo root — peek may read any file under here. */
  workspaceRoot: string;
  /** Directory that contains scene .ts files (write sandbox). */
  sceneDir: string;
};

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
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  if (abs !== root && !abs.startsWith(prefix)) {
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
      const pos = sourceFile.getLineAndCharacterOfPosition(
        call.getStart(sourceFile),
      );
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

  if (name === "editNumber") {
    const arg = call.arguments[0];
    if (!arg) throw new Error("editNumber expects a numeric value");
    if (values[0] === undefined) throw new Error("editNumber write needs a value");
    const span = numericSpan(sourceFile, arg);
    if (!span) throw new Error("editNumber value is not a numeric literal");
    spans.push({ ...span, text: formatNum(values[0]) });
  } else if (name === "editPoint" || name === "editPoint3") {
    const needed = name === "editPoint3" ? 3 : 2;
    if (call.arguments.length < needed) {
      throw new Error(`${name} expects ${needed} arguments`);
    }
    if (values.length < needed) {
      throw new Error(`${name} write needs ${needed} values`);
    }
    for (let i = 0; i < needed; i++) {
      const arg = call.arguments[i];
      const v = values[i];
      if (!arg || v === undefined) throw new Error(`${name} missing argument ${i}`);
      const span = numericSpan(sourceFile, arg);
      if (!span) throw new Error(`${name} args are not numeric literals`);
      spans.push({ ...span, text: formatNum(v) });
    }
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

export function sceneDevPlugin(opts: SceneDevOptions): Plugin {
  const workspaceRoot = path.resolve(opts.workspaceRoot);
  const sceneDir = path.resolve(opts.sceneDir);

  return {
    name: "scene-dev",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url?.split("?")[0] ?? "";
        try {
          if (url === "/__write-widget" && req.method === "POST") {
            const raw = JSON.parse(await readBody(req)) as Record<
              string,
              unknown
            >;
            const file = raw.file;
            const values = raw.values;

            if (
              typeof file !== "string" ||
              !Array.isArray(values) ||
              !values.every((v) => typeof v === "number")
            ) {
              json(res, 400, {
                ok: false,
                error: `invalid body: expected { file, widgetIndex, values }; got keys [${Object.keys(raw).join(", ")}]`,
              });
              return;
            }

            const abs = resolveUnder(sceneDir, path.basename(file));
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
                error: `invalid body: need widgetIndex; got keys [${Object.keys(raw).join(", ")}]`,
              });
              return;
            }

            fs.writeFileSync(abs, patchWidget(source, widgetIndex, values));
            json(res, 200, { ok: true });
            return;
          }

          if (url === "/__peek" && req.method === "GET") {
            const u = new URL(req.url ?? "", "http://127.0.0.1");
            const file = (u.searchParams.get("file") ?? "").replace(/^\/+/, "");
            const abs = resolveUnder(workspaceRoot, file);
            if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
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
