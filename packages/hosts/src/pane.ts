import type { InspectPatch } from "@design-scenes/shell";

import { commitWidget, peekFile } from "./inspect";

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

export function showWidgetInspect(
  push: InspectPush,
  kind: string,
  site: string,
  writeFile: string,
  meta: string,
): void {
  push({
    crumb: `widget ${kind} ${site} · writes ${writeFile}`,
    meta,
    sourceHtml: `<code class="empty">Widget values are the numeric arguments of edit* in ${writeFile}.</code>`,
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

export function setPaneStatus(push: InspectPush, status: string, error: string | null): void {
  push({ status, error });
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
