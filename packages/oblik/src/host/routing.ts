import type { OblikSceneEntry } from "../source/catalog";

export function currentSceneId(): string | null {
  const sceneParam = new URLSearchParams(location.search).get("scene");
  return sceneParam && sceneParam !== "welcome" ? sceneParam : null;
}

export function openScene(id: string): void {
  const url = `${location.pathname}?scene=${encodeURIComponent(id)}`;
  history.pushState(null, "", url);
}

export function navItems(scenes: OblikSceneEntry[]): OblikSceneEntry[] {
  return [...scenes].toSorted((a, b) => a.title.localeCompare(b.title));
}
