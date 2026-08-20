import {
  beginGeomFrame,
  flatten3,
  type Drawable3,
  type Geom,
} from "@design-scenes/geom";
import {
  beginWidgetFrame3,
  getGizmos3,
  type Gizmo3,
} from "./widgets.ts";

export type Frame3 = {
  geom: Geom | Geom[];
  drawables: Drawable3[];
  gizmos: readonly Gizmo3[];
};

export type SceneModule3 = {
  view: "euclid3";
  scene: () => Geom | Geom[];
  sceneFile: string;
};

export function runScene3(mod: SceneModule3): Frame3 {
  beginGeomFrame();
  beginWidgetFrame3();
  const geom = mod.scene();
  return {
    geom,
    drawables: flatten3(geom),
    gizmos: getGizmos3(),
  };
}
