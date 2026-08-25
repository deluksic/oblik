export type Euclid2Scene = {
  kind: "euclid2";
  title: string;
  hint?: string;
  camera?: { x: number; y: number; scale: number };
  build: () => unknown;
};

/** Discriminated union. Add a member when a scene kind ships — not a host registry. */
export type Scene = Euclid2Scene;

export function defineScene<T extends Scene>(scene: T): T {
  return scene;
}
