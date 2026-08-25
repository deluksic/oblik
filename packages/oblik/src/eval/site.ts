import type { StyleKind } from "./style";

export const $site = Symbol("oblik.site");
export const $node = Symbol("oblik.node");

export type SiteSpec = {
  /** 0-based constructor args that must be numeric literals for editable. */
  dof: readonly number[];
  /** Geom / slider kind this call traces — the style discriminant. */
  kind: StyleKind;
};

export type SiteFn = ((...args: never[]) => unknown) & { [$site]?: SiteSpec };

export function siteOf(fn: SiteFn): SiteSpec | undefined {
  return fn[$site];
}
