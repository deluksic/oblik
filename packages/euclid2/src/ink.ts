/**
 * Cream strokes vs handle ink. Gizmo construction lives next to
 * `gizmosFromDrawables` — this file is the draw-frame skip hook so we do not
 * paint an editable primitive twice.
 */
export function handleOwnsInk(geom: { editable?: boolean }): boolean {
  return geom.editable === true;
}
