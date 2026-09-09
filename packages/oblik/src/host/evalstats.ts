import { createStoredSignal } from "./StoredSignalsContext";

/** Debug chip toggle: `{ms}ms · built · cached` on 2D paper panes. */
export function createEvalstatsSetting() {
  return createStoredSignal<boolean>("oblik.evalstats", { defaultValue: false });
}
