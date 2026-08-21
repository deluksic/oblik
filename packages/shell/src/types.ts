export const VIEW_KINDS = ["euclid2", "euclid3", "sdf", "sdf2"] as const;
export type ViewKind = (typeof VIEW_KINDS)[number];

export type SceneLayout = {
  /** CSS `grid-template-areas`. Cell names are scene ids. */
  areas: string;
  columns?: string;
  rows?: string;
};

export type SceneEntry = {
  id: string;
  file: string;
  title: string;
  view: ViewKind;
  layout?: SceneLayout;
  hasScene: boolean;
  error?: string;
};

export type InspectState = {
  crumb: string;
  meta: string;
  sourceHtml: string;
  status: string;
  error: string | null;
};

export type InspectPatch = Partial<InspectState>;

export type CommandSpec = {
  id: string;
  title: string;
  hint: string;
};

export type PaneHandle = {
  refresh: (opts?: { quiet?: boolean }) => void;
  dispose: () => void;
  commands?: () => CommandSpec[];
  runCommand?: (id: string) => void;
  cancelCommand?: () => void;
};

export type CommandBarState = {
  previewHtml: string;
  acceptNumber?: boolean;
  hint?: string;
  numberValue?: string;
  onNumber?: (n: number) => void;
  onNumberDraft?: (raw: string) => void;
};

export type PaneContext = {
  sceneId: string;
  sceneFile: string;
  onLiveChange: () => void;
  onFocus: () => void;
  onCommandBar?: (state: CommandBarState | null) => void;
  onInspect?: (patch: InspectPatch) => void;
};

export type ViewHost = {
  mount: (canvas: HTMLCanvasElement, mod: Record<string, unknown>, ctx: PaneContext) => PaneHandle;
};

export type SceneLoaderMap = Record<string, () => Promise<Record<string, unknown>>>;

export type WorkspaceProps = {
  scenes: SceneEntry[];
  loaders: SceneLoaderMap;
  hosts: Partial<Record<ViewKind, ViewHost>>;
};
