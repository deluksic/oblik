export const HANDLE_R = 7;
export const POINT_R = 3.5;
/** Wider than a derived point, narrower than the grab hit target. */
export const EDITABLE_POINT_R = 5;
export const SNAP_R = 9;
/** Crossing snap diamond half-diagonal (kept smaller than SNAP_R so it reads
 * point-sized, not larger than the dots it marks). */
export const SNAP_DIAMOND_R = 5;

export function pointMarkRadius(editable: boolean): number {
  return editable ? EDITABLE_POINT_R : POINT_R;
}
