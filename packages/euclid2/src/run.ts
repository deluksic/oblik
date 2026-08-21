import { beginGeomFrame, flatten, type Drawable, type Geom } from "@design-scenes/geom";

import { beginWidgetFrame, getGizmos, type Gizmo } from "./widgets";

export type Frame = {
  geom: Geom | Geom[];
  drawables: Drawable[];
  gizmos: readonly Gizmo[];
};

export type SceneModule = {
  scene: () => Geom | Geom[];
  sceneFile: string;
  view?: "euclid2";
};

export function runScene(mod: SceneModule, source = ""): Frame {
  beginGeomFrame();
  beginWidgetFrame(source);
  const geom = mod.scene();
  return {
    geom,
    drawables: flatten(geom),
    gizmos: getGizmos(),
  };
}
