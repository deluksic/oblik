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

export type LineDash = "solid" | "dashed" | "dotted";

export type LineStyle = {
  color?: string;
  width?: number;
  dash?: LineDash;
};

export type PointStyle = {
  color?: string;
  size?: number;
};

/** Constructor ink. Missing / null means the object uses the view default. */
export type ObjectStyle = {
  line?: LineStyle;
  point?: PointStyle;
};

export type StyleChannel = "line" | "point";

export const DEFAULT_LINE_STYLE: LineStyle = {
  color: "#d7d2c4",
  width: 1.5,
  dash: "solid",
};

export const DEFAULT_POINT_STYLE: PointStyle = {
  color: "#d7d2c4",
  size: 3.5,
};

export type OriginQuoteLine = {
  line: number;
  text: string;
  current: boolean;
};

export type OriginCaller = {
  who: string;
  loc: string;
};

export type OriginView =
  | { kind: "empty"; message: string }
  | {
      kind: "origin";
      who: string;
      file: string;
      quote: OriginQuoteLine[];
      callers: OriginCaller[];
    };

export type InspectState = {
  crumb: string;
  meta: string;
  origin: OriginView;
  status: string;
  error: string | null;
  /** World cursor, shown on the right of the pane status strip. */
  cursor?: string | null;
  /** Current constructor style; `null` is default ink. */
  style?: ObjectStyle | null;
  /** Which editor to show. `null` hides the style block. */
  styleChannel?: StyleChannel | null;
  onStyleChange?: (style: ObjectStyle | null) => void;
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
  /** Typed binding name is present but not a valid identifier. */
  draftInvalid?: boolean;
  draftError?: string;
  /** Active inline slot: numbers, or an identifier for slider names. */
  draftKind?: "number" | "ident";
  onNumber?: (n: number) => void;
  onNumberDraft?: (raw: string) => void;
  /** Enter — compile from the full session, not only the focused slot. */
  onCommit?: () => void;
  /** Tab / Shift+Tab between slider fields. */
  onNextField?: (dir?: 1 | -1) => void;
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
  onSceneCreated?: (entry: SceneEntry) => void | Promise<void>;
};
