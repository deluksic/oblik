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

export async function createScene(id: string): Promise<string> {
  const res = await fetch("/__create-scene", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  const body = (await res.json()) as { ok?: boolean; error?: string; id?: string };
  if (!res.ok || !body.ok || !body.id) {
    throw new Error(body.error ?? `create failed (${res.status})`);
  }
  return body.id;
}
