import { For, Show, type ParentProps } from "solid-js";

import type { DrawOp, RegionPaint } from "@/geom/region-draw";

type InkClass = string | Array<string | Record<string, boolean>> | Record<string, boolean>;

function clipUrl(id: string): string {
  return `url(#${id})`;
}

export function regionMaskId(id: string): string {
  return `reg-${id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

export function RegionMaskDefs(props: { paint: RegionPaint; id: string }) {
  const box = () => props.paint.box;
  const w = () => box().maxX - box().minX;
  const h = () => box().maxY - box().minY;
  return (
    <defs>
      <mask
        id={`${props.id}-m`}
        maskUnits="userSpaceOnUse"
        x={box().minX}
        y={box().minY}
        width={w()}
        height={h()}
      >
        <rect x={box().minX} y={box().minY} width={w()} height={h()} fill="#000" />
        <RegionOp op={props.paint.stock} fill="#fff" stroke="none" />
        <For each={props.paint.holes}>{(op) => <RegionOp op={op} fill="#000" stroke="none" />}</For>
      </mask>
      <Show when={props.paint.keepClip}>
        {(d) => (
          <clipPath id={`${props.id}-k`} clipPathUnits="userSpaceOnUse">
            <path d={d()} />
          </clipPath>
        )}
      </Show>
      <Show when={props.paint.islandClip}>
        {(d) => (
          <clipPath id={`${props.id}-i`} clipPathUnits="userSpaceOnUse">
            <path d={d()} />
          </clipPath>
        )}
      </Show>
    </defs>
  );
}

export function RegionClipped(
  props: ParentProps<{
    id: string;
    keepClip?: string;
    islandClip?: string;
  }>,
) {
  const island = () =>
    props.islandClip ? (
      <g clip-path={clipUrl(`${props.id}-i`)}>{props.children}</g>
    ) : (
      props.children
    );
  return props.keepClip ? <g clip-path={clipUrl(`${props.id}-k`)}>{island()}</g> : island();
}

export function RegionOp(props: {
  op: DrawOp;
  fill?: string;
  stroke?: string;
  mask?: string;
  class?: InkClass;
  opacity?: number;
  "stroke-width"?: string | number;
  "stroke-dasharray"?: string;
  "stroke-linecap"?: "round" | "butt" | "square";
  "stroke-linejoin"?: "round" | "miter" | "bevel";
  "vector-effect"?: "non-scaling-stroke" | "none";
  "data-ink"?: string;
  "data-role"?: string;
  "clip-path"?: string;
}) {
  const rest = () => ({
    fill: props.fill,
    stroke: props.stroke,
    mask: props.mask,
    class: props.class,
    opacity: props.opacity,
    "stroke-width": props["stroke-width"],
    "stroke-dasharray": props["stroke-dasharray"],
    "stroke-linecap": props["stroke-linecap"],
    "stroke-linejoin": props["stroke-linejoin"],
    "vector-effect": props["vector-effect"],
    "data-ink": props["data-ink"],
    "data-role": props["data-role"],
    "clip-path": props["clip-path"],
  });
  return (
    <Show
      when={props.op.kind === "circle" ? props.op : undefined}
      fallback={<path d={props.op.kind === "profile" ? props.op.d : ""} {...rest()} />}
    >
      {(c) => <circle cx={c().cx} cy={c().cy} r={c().r} {...rest()} />}
    </Show>
  );
}

export function regionMaskUrl(id: string): string {
  return clipUrl(`${id}-m`);
}
