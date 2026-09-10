import { vec2f } from "typegpu/data";

import type { SpanArc, SpanSeg, SpanSet } from "./fillSpans";
import { FillArc, FillSeg, type FillArcValue, type FillSegValue } from "./schemas";

/** One slot write: the record and where it goes. */
export type SpanWrite<V> = { idx: number; value: V };

/**
 * The CPU span records (`fillSpans.ts`, plain `Vec2`s in `#geom` terms) and the
 * GPU structs (`schemas.ts`) meet here — the one place that translation lives,
 * for the pooled world fills and the per-tick overlay alike.
 */
export function toSegValue(e: SpanSeg): FillSegValue {
  return FillSeg({ a: vec2f(e.a.x, e.a.y), b: vec2f(e.b.x, e.b.y) });
}

export function toArcValue(e: SpanArc): FillArcValue {
  return FillArc({
    a: vec2f(e.a.x, e.a.y),
    b: vec2f(e.b.x, e.b.y),
    center: vec2f(e.center.x, e.center.y),
    radius: e.radius,
    span: e.span,
  });
}

/** Append `segs` as contiguous writes starting at slot `start`. */
export function pushSegWrites(
  out: SpanWrite<FillSegValue>[],
  start: number,
  segs: readonly SpanSeg[],
): void {
  for (let i = 0; i < segs.length; i++) out.push({ idx: start + i, value: toSegValue(segs[i]!) });
}

/** Append `arcs` as contiguous writes starting at slot `start`. */
export function pushArcWrites(
  out: SpanWrite<FillArcValue>[],
  start: number,
  arcs: readonly SpanArc[],
): void {
  for (let i = 0; i < arcs.length; i++) out.push({ idx: start + i, value: toArcValue(arcs[i]!) });
}

/**
 * Contiguous writes from slot 0 for a per-frame (overlay) span array, capped at
 * the capacity so a runaway ghost cannot overflow the buffer.
 */
export function spanWrites(
  spans: SpanSet,
  segCap: number,
  arcCap: number,
): { segs: SpanWrite<FillSegValue>[]; arcs: SpanWrite<FillArcValue>[] } {
  const segs: SpanWrite<FillSegValue>[] = [];
  const arcs: SpanWrite<FillArcValue>[] = [];
  const segCount = Math.min(segCap, spans.segs.length);
  for (let i = 0; i < segCount; i++) segs.push({ idx: i, value: toSegValue(spans.segs[i]!) });
  const arcCount = Math.min(arcCap, spans.arcs.length);
  for (let i = 0; i < arcCount; i++) arcs.push({ idx: i, value: toArcValue(spans.arcs[i]!) });
  return { segs, arcs };
}
