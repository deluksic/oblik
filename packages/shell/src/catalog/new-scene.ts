export function newSceneSource(id: string, title: string): string {
  return `import { circle } from "@design-scenes/geom";
import { editDistanceToPoint, editPoint } from "@design-scenes/euclid2";

export const title = ${JSON.stringify(title)};
export const view = "euclid2" as const;
export const sceneFile = ${JSON.stringify(`${id}.scene.ts`)};

export function scene() {
  const c = editPoint(0, 0);
  const r = editDistanceToPoint(c, 1);
  return circle(c, r);
}
`;
}

export function titleFromId(id: string): string {
  return id
    .split("-")
    .filter(Boolean)
    .map((w) => w.slice(0, 1).toUpperCase() + w.slice(1))
    .join(" ");
}
