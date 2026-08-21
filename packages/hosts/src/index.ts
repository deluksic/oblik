import type { ViewHost, ViewKind } from "@design-scenes/shell";

import { euclid2Host, sdf2Host } from "./paper2.ts";
import { euclid3Host, sdfHost } from "./paper3.ts";

export { euclid2Host, sdf2Host } from "./paper2.ts";
export { euclid3Host, sdfHost } from "./paper3.ts";

export const defaultHosts: Record<ViewKind, ViewHost> = {
  euclid2: euclid2Host,
  euclid3: euclid3Host,
  sdf: sdfHost,
  sdf2: sdf2Host,
};
