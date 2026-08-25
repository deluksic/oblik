import { formatNum } from "./patch";

export type Expr =
  | { kind: "num"; value: number }
  | { kind: "ref"; name: string }
  | { kind: "call"; name: string; args: Expr[] };

export function printExpr(expr: Expr): string {
  if (expr.kind === "num") return formatNum(expr.value);
  if (expr.kind === "ref") return expr.name;
  return `${expr.name}(${expr.args.map(printExpr).join(", ")})`;
}
