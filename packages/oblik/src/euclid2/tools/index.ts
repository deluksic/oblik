import type { TraceNode } from "../../eval/context";
import { firstInvalid, focusedDraft, keySession, tabSession, typeSession, withSlot } from "./draft";
import { circle } from "./circle";
import { line } from "./line";
import { parallelLine } from "./parallelLine";
import { point } from "./point";
import { segment } from "./segment";
import { scopeFromTrace, scopeOf } from "./scope";
import type { PlaceCtx, PlaceHit, Scope, Tool, ToolId, ToolKey, ToolSession } from "./types";

export type {
  Draft,
  Ghost,
  InsertJob,
  PlaceCtx,
  PlaceHit,
  Preview,
  Scope,
  Tool,
  ToolId,
  ToolKey,
  ToolSession,
  ToolSpec,
  ToolStep,
} from "./types";
export { exprOfPlace } from "./common";
export { scopeFromTrace } from "./scope";

const byId = {
  point,
  circle,
  line,
  segment,
  parallelLine,
} as const satisfies Record<ToolId, Tool>;

export const TOOLS = [point.spec, circle.spec, line.spec, segment.spec, parallelLine.spec] as const;

function of(session: ToolSession): Tool {
  return byId[session.verb];
}

export function toolById(id: ToolId): Tool {
  return byId[id];
}

export function filterTools(query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return [...TOOLS];
  return TOOLS.filter(
    (t) =>
      t.title.toLowerCase().includes(q) ||
      t.id.toLowerCase().includes(q) ||
      t.aliases?.some((a) => a.includes(q) || q.includes(a)),
  );
}

export function startTool(id: ToolId): ToolSession {
  return byId[id].start();
}

export function clickTool(session: ToolSession, hit: PlaceHit, scope: Scope | readonly string[] = []) {
  const sc = scopeOf(scope);
  const tool = of(session);
  const next = tool.click(session as never, hit, sc);
  if ("insert" in next && firstInvalid(tool, session as never, sc)) return { session };
  return next;
}

export function ghostOf(session: ToolSession, place: PlaceHit | null, scope: Scope | readonly string[] = []) {
  return of(session).ghost(session as never, place, scopeOf(scope));
}

export function previewOf(
  session: ToolSession,
  place: PlaceHit | null = null,
  scope: Scope | readonly string[] = [],
) {
  const tool = of(session);
  const sc = scopeOf(scope);
  return withSlot(tool.preview(session as never, place, sc), focusedDraft(tool, session as never, sc));
}

export function tabTool(session: ToolSession, dir: 1 | -1 = 1): ToolSession {
  return tabSession(of(session), session as never, dir);
}

export function typeTool(session: ToolSession, raw: string): ToolSession {
  return typeSession(of(session), session as never, raw);
}

export function keyTool(
  session: ToolSession,
  e: ToolKey,
  place: PlaceHit | null = null,
  scope: Scope | readonly string[] = [],
) {
  const out = keySession(of(session), session as never, e, place, scopeOf(scope));
  if ("ignore" in out) return undefined;
  return out;
}

export function commitTool(session: ToolSession, place: PlaceHit | null = null, scope: Scope | readonly string[] = []) {
  const sc = scopeOf(scope);
  const tool = of(session);
  if (firstInvalid(tool, session as never, sc)) return undefined;
  return tool.commit?.(session as never, place, sc) ?? undefined;
}

export function enrichHit(session: ToolSession, hit: PlaceHit, ctx: PlaceCtx): PlaceHit {
  return of(session).hit?.(session as never, hit, ctx) ?? hit;
}

export function hoverTool(session: ToolSession, hit: PlaceHit, trace: readonly TraceNode[]): string | null {
  return of(session).hover?.(session as never, hit, trace) ?? null;
}
