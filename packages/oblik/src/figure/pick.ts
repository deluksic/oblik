import { isFiniteTrace, traceKey } from "../euclid2/pick";
import { mentionExpr, type Scope } from "../euclid2/tool";
import type { TraceNode } from "../eval/context";
import { isGeomKind, paintsCovering } from "../eval/paint";

export function isDrawnGeom(n: TraceNode): boolean {
  if (!isFiniteTrace(n)) return false;
  return isGeomKind(n.value.kind);
}

/** Shift+brush may only target geom this scope can name. */
export function brushAddHits(geoms: readonly TraceNode[], scope?: Scope): TraceNode[] {
  if (!scope) return [];
  return geoms.filter((n) => isDrawnGeom(n) && mentionExpr(scope, n) !== undefined);
}

/** Map construction hits to covering paint nodes, topmost first. */
export function inkFromGeomHits(
  trace: readonly TraceNode[],
  geoms: readonly TraceNode[],
): TraceNode[] {
  const seen = new Set<string>();
  const out: TraceNode[] = [];
  for (const g of geoms) {
    const covering = paintsCovering(trace, g);
    for (let i = covering.length - 1; i >= 0; i--) {
      const p = covering[i]!;
      const k = traceKey(p);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(p);
    }
  }
  return out;
}
