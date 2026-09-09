import { tgpu } from "typegpu";
import type { TgpuRoot } from "typegpu";

let root: TgpuRoot | undefined;
let pending: Promise<TgpuRoot> | undefined;
let refs = 0;

export function hasWebGPU(): boolean {
  return typeof navigator !== "undefined" && navigator.gpu !== undefined;
}

/** Refcounted app-lifetime root: created on first pane, destroyed on last release. */
export function acquireRoot(): Promise<TgpuRoot> {
  refs += 1;
  if (root) return Promise.resolve(root);
  const flight = (pending ??= tgpu.init().then((r) => {
    root = r;
    if (refs === 0) {
      // Released while init was in flight — nothing ever sees this root.
      r.destroy();
      root = undefined;
      pending = undefined;
    }
    return r;
  }));
  return flight;
}

export function releaseRoot(): void {
  if (refs > 0) refs -= 1;
  if (refs === 0 && !pending) {
    root?.destroy();
    root = undefined;
  }
}
