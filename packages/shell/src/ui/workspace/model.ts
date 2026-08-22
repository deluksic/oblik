import type { SceneEntry } from "@/types";

export function currentSceneId(): string | null {
  const sceneParam = new URLSearchParams(location.search).get("scene");
  return sceneParam && sceneParam !== "welcome" ? sceneParam : null;
}

export function sceneHref(id: string | null): string {
  return id ? `?scene=${encodeURIComponent(id)}` : "./";
}

export function openScene(id: string | null): void {
  const url = id ? `${location.pathname}?scene=${encodeURIComponent(id)}` : location.pathname;
  history.pushState(null, "", url);
}

export function catalogById(scenes: SceneEntry[]): Map<string, SceneEntry> {
  return new Map(scenes.map((s) => [s.id, s]));
}

export function loaderKey(file: string): string {
  return `./scenes/${file}`;
}

export function navItems(scenes: SceneEntry[]): SceneEntry[] {
  return [...scenes].toSorted((a, b) => a.title.localeCompare(b.title));
}

export async function createScene(id: string): Promise<{ id: string; entry: SceneEntry }> {
  const res = await fetch("/__create-scene", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  const body = (await res.json()) as {
    ok?: boolean;
    error?: string;
    id?: string;
    entry?: SceneEntry;
  };
  if (!res.ok || !body.ok || !body.id || !body.entry) {
    throw new Error(body.error ?? `create failed (${res.status})`);
  }
  return { id: body.id, entry: body.entry };
}

export function mergeSceneEntry(list: SceneEntry[], entry: SceneEntry): SceneEntry[] {
  const rest = list.filter((s) => s.id !== entry.id);
  return [...rest, entry].toSorted((a, b) => a.title.localeCompare(b.title));
}
