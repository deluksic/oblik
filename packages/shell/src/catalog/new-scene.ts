export function newSceneSource(id: string, title: string): string {
  return `export const title = ${JSON.stringify(title)};
export const view = "euclid2" as const;
export const sceneFile = ${JSON.stringify(`${id}.scene.ts`)};

export function scene() {}
`;
}

export function titleFromId(id: string): string {
  return id
    .split("-")
    .filter(Boolean)
    .map((w) => w.slice(0, 1).toUpperCase() + w.slice(1))
    .join(" ");
}
