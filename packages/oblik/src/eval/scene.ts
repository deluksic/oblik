export type Euclid2Scene = {
  kind: "euclid2";
  title: string;
  hint?: string;
  camera?: { x: number; y: number; scale: number };
  build: () => unknown;
};

export type FigureScene = {
  kind: "figure";
  title: string;
  hint?: string;
  camera?: { x: number; y: number; scale: number };
  paper?: "cream" | "white";
  /** World-unit artboard. Letterboxed in the pane; omit to fill the view. */
  frame?: { width: number; height: number };
  build: () => unknown;
};

/** Discriminated union. Add a member when a scene kind ships — not a host registry. */
export type Scene = Euclid2Scene | FigureScene;

export function defineScene<T extends Scene>(scene: T): T {
  return scene;
}
