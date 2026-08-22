import type { CommandBarState } from "@/types";

export function commandBarSnapshotKey(state: CommandBarState | null): string {
  if (!state) return "";
  return JSON.stringify({
    previewHtml: state.previewHtml,
    hint: state.hint ?? "",
    numberValue: state.numberValue ?? "",
    acceptNumber: state.acceptNumber === true,
    draftInvalid: state.draftInvalid === true,
    draftError: state.draftError ?? "",
    draftKind: state.draftKind ?? "number",
  });
}

export function inspectSnapshotKey(patch: Record<string, unknown>): string {
  return JSON.stringify(patch);
}
