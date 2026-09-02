import { formatNum } from "./patch";

/** Circle `.radius` or parallel `.distance` — a lookup, not the Expr field enum. */
export type ProductField = "radius" | "distance";

export type Expr =
  | { kind: "num"; value: number }
  | { kind: "str"; value: string }
  | { kind: "ref"; name: string }
  | { kind: "member"; object: Expr; field: string }
  | { kind: "neg"; expr: Expr }
  | { kind: "props"; props: Record<string, Expr> }
  | { kind: "array"; items: Expr[] }
  | { kind: "call"; name: string; args: Expr[] };

export function member(object: Expr | string, field: string): Expr {
  return {
    kind: "member",
    object: typeof object === "string" ? { kind: "ref", name: object } : object,
    field,
  };
}

export function printExpr(expr: Expr): string {
  if (expr.kind === "num") return formatNum(expr.value);
  if (expr.kind === "str") return JSON.stringify(expr.value);
  if (expr.kind === "ref") return expr.name;
  if (expr.kind === "member") {
    const inner =
      expr.object.kind === "ref" || expr.object.kind === "member"
        ? printExpr(expr.object)
        : `(${printExpr(expr.object)})`;
    return `${inner}.${expr.field}`;
  }
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

/** `plate.drill` → member chain. Field names do not contain dots. */
export function parsePath(name: string): Expr {
  const parts = name.split(".").filter(Boolean);
  if (parts.length === 0) return { kind: "ref", name };
  const root = parts[0]!;
  return parts
    .slice(1)
    .reduce<Expr>((obj, field) => ({ kind: "member", object: obj, field }), {
      kind: "ref",
      name: root,
    });
}

export function rootRef(expr: Expr): string | null {
  if (expr.kind === "ref") return expr.name;
  if (expr.kind === "member") return rootRef(expr.object);
  if (expr.kind === "neg") return rootRef(expr.expr);
  return null;
}

/** Root identifier names an insert validator must find in scope. */
export function exprRefs(expr: Expr): string[] {
  if (expr.kind === "ref") return [expr.name];
  if (expr.kind === "member") return exprRefs(expr.object);
  if (expr.kind === "call") return expr.args.flatMap(exprRefs);
  if (expr.kind === "array") return expr.items.flatMap(exprRefs);
  if (expr.kind === "neg") return exprRefs(expr.expr);
  if (expr.kind === "props") return Object.values(expr.props).flatMap(exprRefs);
  return [];
}
