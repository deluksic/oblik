import { beginGeomFrame, flatten, type Drawable, type Geom } from "../lib/geom.ts";
import {
  beginWidgetFrame,
  getGizmos,
  type Gizmo,
} from "./widgets.ts";

export type Frame = {
  geom: Geom | Geom[];
  drawables: Drawable[];
  gizmos: readonly Gizmo[];
};

export type SceneModule = {
  scene: () => Geom | Geom[];
  sceneFile: string;
};

export function runScene(mod: SceneModule): Frame {
  beginGeomFrame();
  beginWidgetFrame();
  const geom = mod.scene();
  return {
    geom,
    drawables: flatten(geom),
    gizmos: getGizmos(),
  };
}
