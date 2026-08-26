import { formatNum } from "./patch";

export type ProductField = "radius" | "distance";

export type Expr =
  | { kind: "num"; value: number }
  | { kind: "str"; value: string }
  | { kind: "ref"; name: string }
  | { kind: "member"; object: string; field: ProductField }
  | { kind: "neg"; expr: Expr }
  | { kind: "props"; props: Record<string, Expr> }
  | { kind: "array"; items: Expr[] }
  | { kind: "call"; name: string; args: Expr[] };

export function printExpr(expr: Expr): string {
  if (expr.kind === "num") return formatNum(expr.value);
  if (expr.kind === "str") return JSON.stringify(expr.value);
  if (expr.kind === "ref") return expr.name;
  if (expr.kind === "member") return `${expr.object}.${expr.field}`;
  if (expr.kind === "neg") return `-${printExprNegChild(expr.expr)}`;
  if (expr.kind === "props") {
    const parts = Object.entries(expr.props).map(([k, v]) => `${k}: ${printExpr(v)}`);
    return `{ ${parts.join(", ")} }`;
  }
  if (expr.kind === "array") return `[${expr.items.map(printExpr).join(", ")}]`;
  return `${expr.name}(${expr.args.map(printExpr).join(", ")})`;
}

function printExprNegChild(expr: Expr): string {
  if (expr.kind === "member" || expr.kind === "ref") return printExpr(expr);
  return printExpr(expr);
}
