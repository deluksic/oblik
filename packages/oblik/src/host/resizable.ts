export const SIDEBAR_DEFAULT_WIDTH = 280;
export const SIDEBAR_MIN_WIDTH = 180;
export const SIDEBAR_MAX_WIDTH = 640;
export const SIDEBAR_STORE_ID = "oblik.sidebar-width";

export const SIDEBAR_DEFAULT_HEIGHT = 240;
export const SIDEBAR_MIN_HEIGHT = 120;
export const SIDEBAR_MAX_HEIGHT = 480;
export const SIDEBAR_HEIGHT_STORE_ID = "oblik.sidebar-height";

export function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return SIDEBAR_DEFAULT_WIDTH;
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width));
}

export function clampSidebarHeight(height: number): number {
  if (!Number.isFinite(height)) return SIDEBAR_DEFAULT_HEIGHT;
  return Math.min(SIDEBAR_MAX_HEIGHT, Math.max(SIDEBAR_MIN_HEIGHT, height));
}
