import type { InspectPatch } from "@design-scenes/shell";

import { commitWidget, mapStack, peekFile, pinConstructorSite, renderStackSnippets, stackLabel } from "./inspect";

export function scenePeekPath(sceneFile: string): string {
  return `apps/paper/src/scenes/${sceneFile}`;
}

export function sceneHotKey(sceneFile: string): string {
  return `./scenes/${sceneFile}`;
}

export function observePaneResize(canvas: HTMLCanvasElement, onResize: () => void): () => void {
  const onWinResize = () => onResize();
  window.addEventListener("resize", onWinResize);
  const pane = canvas.parentElement;
  const ro =
    pane && typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => onResize()) : null;
  if (pane && ro) ro.observe(pane);
  return () => {
    window.removeEventListener("resize", onWinResize);
    ro?.disconnect();
  };
}

export function cssSize(canvas: HTMLCanvasElement): { w: number; h: number } {
  const r = canvas.getBoundingClientRect();
  return { w: r.width, h: r.height };
}

export function eventPos(canvas: HTMLCanvasElement, e: PointerEvent): { x: number; y: number } {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

/** Pointer travel below this is a click, not a drag. */
export const PICK_CLICK_PX = 4;

export function movedPastClick(fromX: number, fromY: number, toX: number, toY: number): boolean {
  return Math.hypot(toX - fromX, toY - fromY) >= PICK_CLICK_PX;
}

export type InspectPush = (patch: InspectPatch) => void;

/**
 * Sticky canvas pick. Hover is ephemeral; this is what the sidebar keeps.
 *
 * Geom vs gizmo stays an *evaluation* split (libraries stay gizmo-free;
 * handles are declared editors). Pick already unifies them — `hitTest`
 * returns one target — so anything hoverable is selectable.
 */
export type Selection =
  | { target: "geom"; id: string }
  | { target: "gizmo"; id: string };

export function pruneSelection(
  selected: Selection | null,
  geomIds: Iterable<string>,
  gizmoIds: Iterable<string>,
): Selection | null {
  if (!selected) return null;
  const pool = selected.target === "geom" ? geomIds : gizmoIds;
  for (const id of pool) if (id === selected.id) return selected;
  return null;
}

export async function showWidgetInspect(
  push: InspectPush,
  peekCache: Map<string, string>,
  g: {
    kind: string;
    bind?: string;
    site: string;
    at: { file: string; line: number; column: number };
    stack?: { file: string; line: number; column: number; name?: string }[];
  },
  meta: string,
): Promise<void> {
  const raw =
    g.stack && g.stack.length > 0
      ? g.stack
      : [{ file: g.at.file, line: g.at.line, column: g.at.column }];
  const stack = pinConstructorSite(await mapStack(raw), g.at);
  push({
    crumb: g.bind ?? g.kind,
    meta: `${g.site} · ${stackLabel(stack) || meta}`,
    sourceHtml: await renderStackSnippets(stack, peekCache),
  });
}

export function showEmptyInspect(
  push: InspectPush,
  crumb: string,
  meta: string,
  sourceHtml: string,
): void {
  push({ crumb, meta, sourceHtml });
}

export function setPaneStatus(
  push: InspectPush,
  status: string,
  error: string | null,
  cursor?: string | null,
): void {
  push(cursor === undefined ? { status, error } : { status, error, cursor });
}

export async function commitGizmoIfChanged(
  peekCache: Map<string, string>,
  start: number[],
  g: { at: { file: string; line: number; column: number } } | undefined,
  now: number[],
): Promise<string | null> {
  if (!g) return null;
  const changed = now.some((v, i) => v !== start[i]);
  if (!changed) return null;
  const err = await commitWidget(g.at, now);
  if (!err) peekCache.delete(g.at.file);
  return err;
}

export async function warmPeek(
  peekCache: Map<string, string>,
  peekPath: string,
  onReady: () => void,
): Promise<void> {
  await peekFile(peekCache, peekPath);
  onReady();
}

export function subscribeHotReload(
  sceneFile: string,
  subscribe: (cb: (path: string, mod: Record<string, unknown>) => void) => () => void,
  onReload: (mod: Record<string, unknown>) => void,
): () => void {
  const key = sceneHotKey(sceneFile);
  return subscribe((path, next) => {
    if (path !== key) return;
    if (!("scene" in next)) return;
    onReload(next);
  });
}
