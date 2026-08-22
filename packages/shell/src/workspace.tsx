import { render } from "@solidjs/web";

import type { WorkspaceProps } from "@/types";
import { App } from "@/ui/App";

export type { WorkspaceProps };

export function startWorkspace(
  mount: HTMLElement,
  props: WorkspaceProps | (() => WorkspaceProps),
): () => void {
  const read = typeof props === "function" ? props : () => props;
  return render(() => <App {...read()} />, mount);
}
