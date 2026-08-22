import { beginGeomFrame, collectDrawables, type Drawable, type Geom } from "@design-scenes/geom";

import { beginWidgetFrame, getGizmos, type Gizmo } from "./widgets";

export type Frame = {
  geom: Geom | Geom[] | undefined;
  drawables: Drawable[];
  gizmos: readonly Gizmo[];
};

export type SceneModule = {
  scene: () => Geom | Geom[] | void;
  sceneFile: string;
  view?: "euclid2";
};

export function runScene(mod: SceneModule, source = ""): Frame {
  beginGeomFrame();
  beginWidgetFrame(source);
  const geom = mod.scene();
  return {
    geom: geom ?? undefined,
    drawables: collectDrawables(geom),
    gizmos: getGizmos(),
  };
}
