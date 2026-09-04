import type { OblikSceneEntry } from "../source/catalog";

/**
 * Scene id from the URL. `undefined` means no `?scene=` param — the welcome screen.
 * There is deliberately no reserved id: a user scene file named `welcome.ts`
 * (id `welcome`) is a normal scene and must not be shadowed.
 */
export function currentSceneId(): string | undefined {
  const sceneParam = new URLSearchParams(location.search).get("scene");
  return sceneParam || undefined;
}

export function openScene(id: string): void {
  const url = `${location.pathname}?scene=${encodeURIComponent(id)}`;
  history.pushState(undefined, "", url);
}

/** Leave the scene state: drop the `?scene=` param so the URL means welcome. */
export function openWelcome(): void {
  if (currentSceneId() === undefined) return;
  const params = new URLSearchParams(location.search);
  params.delete("scene");
  const query = params.toString();
  history.pushState(undefined, "", query ? `${location.pathname}?${query}` : location.pathname);
}

export function navItems(scenes: OblikSceneEntry[]): OblikSceneEntry[] {
  return [...scenes].toSorted((a, b) => a.title.localeCompare(b.title));
}

export function hasSceneError(scene: OblikSceneEntry): boolean {
  return scene.error !== undefined;
}
