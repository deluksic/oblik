export type Euclid2Scene = {
  kind: "euclid2";
  title: string;
  hint?: string;
  camera?: { x: number; y: number; scale: number };
  build: () => unknown;
};

export function defineScene<T extends Euclid2Scene>(scene: T): T {
  return scene;
}
