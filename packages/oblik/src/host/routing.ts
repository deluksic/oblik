import type { OblikSceneEntry } from "../source/catalog";

export type ChromePins = {
  hover: string | null;
  select: string | null;
  frame: boolean;
  pin: boolean;
};

const EMPTY_PINS: ChromePins = { hover: null, select: null, frame: false, pin: false };

export function chromePinsFrom(search: string): ChromePins {
  const q = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  return {
    hover: q.get("hover"),
    select: q.get("select"),
    frame: q.get("frame") === "1",
    pin: q.get("pin") === "1",
  };
}

export function currentChromePins(): ChromePins {
  if (typeof location === "undefined") return EMPTY_PINS;
  return chromePinsFrom(location.search);
}

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
