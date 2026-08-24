import type { InspectState, SceneLayout } from "@/types";

export const WELCOME_INSPECT: InspectState = {
  crumb: "No scene open",
  meta: "A scene is a file in apps/paper/src/scenes. Layouts are CSS grid areas named by scene id.",
  origin: { kind: "empty", message: "Nothing to inspect until a pane is focused." },
  status: "Open a scene from the nav, or create a new TypeScript file.",
  error: null,
  cursor: null,
};

export function singleSceneLayout(id: string): SceneLayout {
  return { areas: `"${id}"`, columns: "minmax(0, 1fr)" };
}
