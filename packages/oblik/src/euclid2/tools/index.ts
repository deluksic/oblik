import type { TraceNode } from "@/eval/context";

import { circle } from "./circle";
import { firstInvalid, focusedDraft, keySession, tabSession, typeSession, withSlot } from "./draft";
import { fillet } from "./fillet";
import { line } from "./line";
import { parallelLine } from "./parallelLine";
import { perpendicularLine } from "./perpendicularLine";
import { point } from "./point";
import { region } from "./region";
import { roundOffset } from "./roundOffset";
import { scopeOf, type ScopeInput } from "./scope";
import { segment } from "./segment";
import { slider } from "./slider";
import type {
  PlaceCtx,
  PlaceHit,
  Scope,
  Tool,
  ToolId,
  ToolKey,
  ToolSession,
  ToolSpec,
} from "./types";

export type {
  Draft,
  Ghost,
  InsertJob,
  PlaceCtx,
  PlaceHit,
  Preview,
  Scope,
  Tool,
  ToolChrome,
  ToolId,
  ToolKey,
  ToolSession,
  ToolSpec,
  ToolStep,
} from "./types";
export { exprOfPlace } from "./common";
export {
  scopeFromTrace,
  snapFilterOf,
  mutedForScope,
  mentionPrint,
  mentionExpr,
  type ScopeFocus,
} from "./scope";

const byId = {
  point,
  circle,
  line,
  segment,
  parallelLine,
  perpendicularLine,
  slider,
  region,
  roundOffset,
  fillet,
} as Record<ToolId, Tool>;

export const TOOLS = [
  point.spec,
  circle.spec,
  line.spec,
  segment.spec,
  parallelLine.spec,
  perpendicularLine.spec,
  slider.spec,
  region.spec,
  roundOffset.spec,
  fillet.spec,
] as const;

function of(session: ToolSession): Tool {
  return byId[session.verb];
}

export function toolById(id: ToolId): Tool {
  return byId[id];
}

function titleMatch(t: ToolSpec, q: string): boolean {
  if (t.prefix.toLowerCase() === q || t.id.toLowerCase() === q) return true;
  const title = t.title.toLowerCase();
  if (title === q) return true;
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`\\b${escaped}\\b`).test(title)) return true;
  const parts = t.id
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(" ");
  return parts.includes(q);
}

function descriptionMatch(t: ToolSpec, q: string): boolean {
  if (t.hint.toLowerCase().includes(q)) return true;
  return (
    t.aliases?.some((a) => {
      const alias = a.toLowerCase();
      return alias.includes(q) || q.includes(alias);
    }) ?? false
  );
}

export function filterTools(query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return [...TOOLS];
  const byTitle = TOOLS.filter((t) => titleMatch(t, q));
  if (byTitle.length > 0) return byTitle;
  return TOOLS.filter((t) => descriptionMatch(t, q));
}

export function startTool(id: ToolId): ToolSession {
  return byId[id].start();
}

export function clickTool(session: ToolSession, hit: PlaceHit, scope: ScopeInput = []) {
  const sc = scopeOf(scope);
  const tool = of(session);
  const next = tool.click(session as never, hit, sc);
  if ("insert" in next && firstInvalid(tool, session as never, sc)) return { session };
  return next;
}

export function ghostOf(session: ToolSession, place: PlaceHit | null, scope: ScopeInput = []) {
  return of(session).ghost(session as never, place, scopeOf(scope));
}

export function previewOf(
  session: ToolSession,
  place: PlaceHit | null = null,
  scope: ScopeInput = [],
) {
  const tool = of(session);
  const sc = scopeOf(scope);
  return withSlot(
    tool.preview(session as never, place, sc),
    focusedDraft(tool, session as never, sc),
  );
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
  scope: ScopeInput = [],
) {
  const out = keySession(of(session), session as never, e, place, scopeOf(scope));
  if ("ignore" in out) return undefined;
  return out;
}

export function commitTool(
  session: ToolSession,
  place: PlaceHit | null = null,
  scope: ScopeInput = [],
) {
  const sc = scopeOf(scope);
  const tool = of(session);
  if (firstInvalid(tool, session as never, sc)) return undefined;
  return tool.commit?.(session as never, place, sc) ?? undefined;
}

export function enrichHit(session: ToolSession, hit: PlaceHit, ctx: PlaceCtx): PlaceHit {
  return of(session).hit?.(session as never, hit, ctx) ?? hit;
}

export function hoverTool(
  session: ToolSession,
  hit: PlaceHit,
  trace: readonly TraceNode[],
  scope?: Scope,
): string | null {
  return of(session).hover?.(session as never, hit, trace, scope) ?? null;
}

const CHROME_OFF = {
  hideFills: false,
  muteStrokes: false,
  mutePoints: false,
  hideSnap: false,
};

export function toolChrome(session: ToolSession | null | undefined) {
  if (!session) return CHROME_OFF;
  const c = of(session).chrome?.(session as never);
  return {
    hideFills: !!c?.hideFills,
    muteStrokes: !!c?.muteStrokes,
    mutePoints: !!c?.mutePoints,
    hideSnap: !!c?.hideSnap,
  };
}
