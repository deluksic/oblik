import type { TraceNode } from "../../eval/context";
import { focusedDraft, keySession, tabSession, typeSession } from "./draft";
import { circle } from "./circle";
import { line } from "./line";
import { parallelLine } from "./parallelLine";
import { point } from "./point";
import { segment } from "./segment";
import type { PlaceCtx, PlaceHit, Tool, ToolId, ToolKey, ToolSession } from "./types";

export type {
  Draft,
  Ghost,
  InsertJob,
  PlaceCtx,
  PlaceHit,
  Preview,
  Tool,
  ToolId,
  ToolKey,
  ToolSession,
  ToolSpec,
  ToolStep,
} from "./types";
export { exprOfPlace } from "./common";

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

export function clickTool(session: ToolSession, hit: PlaceHit) {
  return of(session).click(session as never, hit);
}

export function ghostOf(session: ToolSession, place: PlaceHit | null) {
  return of(session).ghost(session as never, place);
}

export function previewOf(session: ToolSession, place: PlaceHit | null = null, usedNames: readonly string[] = []) {
  const tool = of(session);
  const preview = tool.preview(session as never, place, usedNames);
  const draft = focusedDraft(tool, session as never, usedNames);
  return draft ? { ...preview, draft } : preview;
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
  usedNames: readonly string[] = [],
) {
  const out = keySession(of(session), session as never, e, place, usedNames);
  if ("ignore" in out) return undefined;
  return out;
}

export function commitTool(session: ToolSession, place: PlaceHit | null = null) {
  return of(session).commit?.(session as never, place) ?? undefined;
}

export function enrichHit(session: ToolSession, hit: PlaceHit, ctx: PlaceCtx): PlaceHit {
  return of(session).hit?.(session as never, hit, ctx) ?? hit;
}

export function hoverTool(session: ToolSession, hit: PlaceHit, trace: readonly TraceNode[]): string | null {
  return of(session).hover?.(session as never, hit, trace) ?? null;
}
