export const HANDLE_R = 7;
export const POINT_R = 3.5;
/** Wider than a derived point, narrower than the grab hit target. */
export const EDITABLE_POINT_R = 5;
export const SNAP_R = 9;

export function pointMarkRadius(editable: boolean): number {
  return editable ? EDITABLE_POINT_R : POINT_R;
}
