import { formatNum } from "./patch";

export type Expr =
  | { kind: "num"; value: number }
  | { kind: "str"; value: string }
  | { kind: "ref"; name: string }
  | { kind: "props"; props: Record<string, Expr> }
  | { kind: "call"; name: string; args: Expr[] };

export function printExpr(expr: Expr): string {
  if (expr.kind === "num") return formatNum(expr.value);
  if (expr.kind === "str") return JSON.stringify(expr.value);
  if (expr.kind === "ref") return expr.name;
  if (expr.kind === "props") {
    const parts = Object.entries(expr.props).map(([k, v]) => `${k}: ${printExpr(v)}`);
    return `{ ${parts.join(", ")} }`;
  }
  return `${expr.name}(${expr.args.map(printExpr).join(", ")})`;
}
