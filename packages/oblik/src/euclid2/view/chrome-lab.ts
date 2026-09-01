/** Id suffixes freeze hover/select so a board can show every state at once. */
export type LabChrome = { hot: boolean; selected: boolean };

export function labChrome(id: string): LabChrome | null {
  if (id.endsWith("_hover")) return { hot: true, selected: false };
  if (id.endsWith("_selected")) return { hot: true, selected: true };
  if (id.endsWith("_idle")) return { hot: false, selected: false };
  return null;
}

export function isLabChromeId(id: string): boolean {
  return labChrome(id) != null;
}

export function resolveChrome(id: string, hover: boolean, selected: boolean): LabChrome {
  return labChrome(id) ?? { hot: hover, selected };
}
