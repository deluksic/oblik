import { render } from "@solidjs/web";

import type { WorkspaceProps } from "./types.ts";
import { App } from "./ui/App.tsx";

export type { WorkspaceProps };

export function startWorkspace(mount: HTMLElement, props: WorkspaceProps): () => void {
  return render(() => <App {...props} />, mount);
}
