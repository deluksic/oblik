import type { SceneLayout } from "@/types";

export { VIEW_KINDS, type ViewKind, type SceneEntry, type SceneLayout } from "@/types";

const ID_RE = /^[a-z][a-z0-9-]*$/;

export function isSceneId(id: string): boolean {
  return ID_RE.test(id);
}

/** Unique scene ids in a CSS grid-template-areas string, first-seen order. */
export function paneIdsFromAreas(areas: string): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const row of areas.match(/"[^"]*"/g) ?? [areas]) {
    const inner = row.replaceAll('"', "");
    for (const tok of inner.trim().split(/\s+/)) {
      if (!tok || tok === ".") continue;
      if (!seen.has(tok)) {
        seen.add(tok);
        ids.push(tok);
      }
    }
  }
  return ids;
}

export function stackedAreas(ids: string[]): string {
  return ids.map((id) => `"${id}"`).join(" ");
}

export function normalizeAreas(s: string): string {
  const t = s.trim();
  if (t.includes('"')) return t;
  return `"${t.replace(/\s+/g, " ")}"`;
}

export function layoutFromIds(ids: string[]): SceneLayout {
  return {
    areas: `"${ids.join(" ")}"`,
    columns: ids.map(() => "1fr").join(" "),
  };
}
