import { render } from "@solidjs/web";

import type { WorkspaceProps } from "@/types";
import { App } from "@/ui/App";

export type { WorkspaceProps };

export function startWorkspace(mount: HTMLElement, props: WorkspaceProps): () => void {
  return render(() => <App {...props} />, mount);
}
