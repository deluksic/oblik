import type { InspectState } from "@/types";

export const WELCOME_INSPECT: InspectState = {
  crumb: "No scene open",
  meta: "A scene is a file in apps/paper/src/scenes. Layouts are CSS grid areas named by scene id.",
  sourceHtml: `<code class="empty">Nothing to inspect until a pane is focused.</code>`,
  status: "Open a scene from the nav, or create a new TypeScript file.",
  error: null,
};

export function singleSceneLayout(id: string) {
  return { areas: `"${id}"`, columns: "minmax(0, 1fr)" };
}
