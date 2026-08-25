import { printExpr, type Expr } from "./expr";

export const INTERSECTION_CTORS = new Set([
  "lineIntersection",
  "circleLineIntersection",
  "circleCircleIntersection",
]);

export const BIND_PREFIX: Record<string, string> = {
  point: "p",
  circle: "c",
  line: "l",
  segment: "s",
  lineIntersection: "x",
  circleLineIntersection: "x",
  circleCircleIntersection: "x",
  parallelLine: "par",
};

const BIND = /^[A-Za-z_][A-Za-z0-9_]*$/;

export type HoistedCall = { bind: string; from: string; args: Expr[] };

function pickBind(used: Set<string>, from: string, requested?: string): string {
  if (requested?.trim()) {
    const n = requested.trim();
    if (!BIND.test(n)) throw new Error("bind must be an identifier");
    if (used.has(n)) throw new Error(`bind ${n} is already used`);
    return n;
  }
  const prefix = BIND_PREFIX[from] ?? "n";
  if (!used.has(prefix)) return prefix;
  for (let i = 2; i < 1000; i++) {
    const n = `${prefix}${i}`;
    if (!used.has(n)) return n;
  }
  throw new Error(`could not allocate bind for ${from}`);
}

/** Allocate `from`'s next bind and record it in `used`. */
export function takeBind(used: Set<string>, from: string, requested?: string): string {
  const bind = pickBind(used, from, requested);
  used.add(bind);
  return bind;
}

/**
 * Lift nested intersection constructors in `exprs` to named statements.
 * Identical crossings (same printed call) share one bind.
 */
export function hoistIntersections(
  exprs: readonly Expr[],
  used: Set<string>,
): { exprs: Expr[]; hoists: HoistedCall[] } {
  const seen = new Map<string, string>();
  const hoists: HoistedCall[] = [];
  const rewrite = (expr: Expr): Expr => {
    if (expr.kind !== "call") return expr;
    const args = expr.args.map(rewrite);
    const next: Expr = { kind: "call", name: expr.name, args };
    if (!INTERSECTION_CTORS.has(expr.name)) return next;
    const key = printExpr(next);
    let bind = seen.get(key);
    if (!bind) {
      bind = takeBind(used, expr.name);
      seen.set(key, bind);
      hoists.push({ bind, from: expr.name, args });
    }
    return { kind: "ref", name: bind };
  };
  return { exprs: exprs.map(rewrite), hoists };
}

export function printHoist(h: HoistedCall): string {
  return `const ${h.bind} = ${printExpr({ kind: "call", name: h.from, args: h.args })}`;
}
