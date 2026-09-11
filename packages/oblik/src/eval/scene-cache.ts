import { newEvalMemo, type EvalMemo } from "./memo";

/**
 * What one **scene visit** caches. Created by the visit's owner
 * (`host/Host.tsx`), not by a module-level store.
 */
export type SceneCache = {
  /** Constructor and user-`memo` results for this visit (docs/prototypes/11.md). */
  memo: EvalMemo;
};

/** The caches for one visit: ask it for the entry belonging to a scene module. */
export type VisitCaches = (scene: object) => SceneCache;

/**
 * A visit's caches, keyed by the scene module **inside** the visit.
 *
 * The two lifetimes are deliberately separate, and each one buys something:
 *
 * - The **visit** owns the store. `Host` makes a new one whenever you navigate,
 *   so nothing a scene computed survives leaving it.
 * - The **module** picks the entry. An HMR re-import hands us a fresh module
 *   object, so the memo is replaced — P11's guarantee, "identical across draft
 *   ticks, replaced exactly when HMR re-imports the source" — *without*
 *   remounting the view. Remounting here would throw away the camera, the
 *   selection and any live edit, which is to say it would throw away the state
 *   of the very edit that caused the re-import.
 *
 * Views rendering the same visit share one store, so a layout showing a scene in
 * several views computes it once.
 */
export function createVisitCaches(): VisitCaches {
  const stores = new WeakMap<object, SceneCache>();
  return (scene) => {
    let hit = stores.get(scene);
    if (!hit) {
      hit = { memo: newEvalMemo() };
      stores.set(scene, hit);
    }
    return hit;
  };
}
