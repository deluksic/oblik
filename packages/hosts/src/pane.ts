import type { InspectPatch } from "@design-scenes/shell";

import { commitWidget, peekFile, renderSnippet } from "./inspect";

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
  | { target: "gizmo"; site: string };

export function pruneSelection(
  selected: Selection | null,
  geomIds: Iterable<string>,
  gizmoSites: Iterable<string>,
): Selection | null {
  if (!selected) return null;
  if (selected.target === "geom") {
    for (const id of geomIds) if (id === selected.id) return selected;
    return null;
  }
  for (const site of gizmoSites) if (site === selected.site) return selected;
  return null;
}

export async function showWidgetInspect(
  push: InspectPush,
  peekCache: Map<string, string>,
  g: { kind: string; site: string; at: { file: string; line: number; column: number } },
  meta: string,
): Promise<void> {
  let sourceHtml = `<code class="empty">Could not read ${g.at.file}.</code>`;
  try {
    const text = await peekFile(peekCache, g.at.file);
    sourceHtml = renderSnippet(text, g.at.line);
  } catch (err) {
    sourceHtml = `<code class="empty">${err instanceof Error ? err.message : String(err)}</code>`;
  }
  push({
    crumb: `widget ${g.kind} ${g.site} · writes ${g.at.file}`,
    meta,
    sourceHtml,
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
