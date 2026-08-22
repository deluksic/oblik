/**
 * Scene callees the editor knows about. Annotator, write-back, and binding
 * lookup all read this table — add a row here instead of three Sets.
 *
 * `dof` — 0-based args that must be numeric literals for `editable: true`.
 * `patch` — 0-based args rewritten on gizmo commit. Omit if not a write site.
 */
export type CallSiteSpec = {
  name: string;
  dof?: readonly number[];
  patch?: readonly number[];
};

export const CALL_SITES: readonly CallSiteSpec[] = [
  { name: "editPoint", dof: [0, 1], patch: [0, 1] },
  { name: "point", dof: [0, 1], patch: [0, 1] },
  { name: "editPoint3", dof: [0, 1, 2], patch: [0, 1, 2] },
  { name: "editDistanceToPoint", dof: [1], patch: [1] },
  { name: "editDistance3", dof: [1], patch: [1] },
  { name: "editPointOnSegment", dof: [1], patch: [1] },
  { name: "editPointOnSegment3", dof: [1], patch: [1] },
  { name: "editPointOnLine", dof: [2], patch: [2] },
  { name: "editNumber", dof: [0], patch: [0] },
  { name: "slider", dof: [0], patch: [0] },
  { name: "editAngle", dof: [1], patch: [1] },
  { name: "editVector", dof: [1, 2], patch: [1, 2] },
  { name: "editOffsetFromLine", dof: [1], patch: [1] },
  { name: "circle", dof: [1], patch: [1] },
  { name: "offsetLine", dof: [1], patch: [1] },
  { name: "line" },
  { name: "segment" },
  { name: "lineIntersection" },
  { name: "circleLineIntersection" },
  { name: "circleCircleIntersection" },
];

const byName = new Map(CALL_SITES.map((s) => [s.name, s]));

export function callSiteSpec(name: string): CallSiteSpec | undefined {
  return byName.get(name);
}

export function isSiteCall(name: string): boolean {
  return byName.has(name);
}

export const SITE_CALL_NAMES = new Set(CALL_SITES.map((s) => s.name));

export const WRITABLE_CALL_NAMES = new Set(
  CALL_SITES.filter((s) => s.patch && s.patch.length > 0).map((s) => s.name),
);

export const EDIT_NAMES = new Set(CALL_SITES.filter((s) => s.name.startsWith("edit")).map((s) => s.name));

/** First index and count of a consecutive `patch` run. */
export function patchSpan(spec: CallSiteSpec): { start: number; count: number } | undefined {
  const idx = spec.patch;
  if (!idx || idx.length === 0) return undefined;
  const start = idx[0]!;
  for (let i = 1; i < idx.length; i++) {
    if (idx[i] !== start + i) {
      throw new Error(`${spec.name}: patch indices must be a consecutive range`);
    }
  }
  return { start, count: idx.length };
}

for (const spec of CALL_SITES) patchSpan(spec);
