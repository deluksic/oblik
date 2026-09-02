import { For, Show, type ParentProps } from "solid-js";

import { REGION_MASK, type DrawOp, type RegionPaint } from "@/geom/region-draw";

import { layerStrokeWidth, type ChromeLayer } from "./chrome";

type InkClass = string | Array<string | Record<string, boolean>> | Record<string, boolean>;

function clipUrl(id: string): string {
  return `url(#${id})`;
}

export function regionMaskId(id: string): string {
  return `reg-${id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

export function regionMaskUrl(id: string): string {
  return clipUrl(`${id}-m`);
}

export function regionOutsideStockUrl(id: string): string {
  return clipUrl(`${id}-x`);
}

export function regionStockUrl(id: string): string {
  return clipUrl(`${id}-s`);
}

export function regionOutsideUrl(id: string): string {
  return clipUrl(`${id}-o`);
}

export function RegionMaskDefs(props: { paint: RegionPaint; id: string }) {
  const box = () => props.paint.box;
  const w = () => box().maxX - box().minX;
  const h = () => box().maxY - box().minY;
  const frame = () => ({
    x: box().minX,
    y: box().minY,
    width: w(),
    height: h(),
  });
  return (
    <defs>
      <mask id={`${props.id}-m`} maskUnits="userSpaceOnUse" {...frame()}>
        <rect {...frame()} fill={REGION_MASK.fill.canvas} />
        <RegionOp op={props.paint.stock} fill={REGION_MASK.fill.stock} stroke="none" />
        <For each={props.paint.holes}>
          {(op) => <RegionOp op={op} fill={REGION_MASK.fill.hole} stroke="none" />}
        </For>
      </mask>
      <mask id={`${props.id}-x`} maskUnits="userSpaceOnUse" {...frame()}>
        <rect {...frame()} fill={REGION_MASK.outsideStock.canvas} />
        <RegionOp op={props.paint.stock} fill={REGION_MASK.outsideStock.stock} stroke="none" />
      </mask>
      <mask id={`${props.id}-s`} maskUnits="userSpaceOnUse" {...frame()}>
        <rect {...frame()} fill={REGION_MASK.stock.canvas} />
        <RegionOp op={props.paint.stock} fill={REGION_MASK.stock.stock} stroke="none" />
      </mask>
      <mask id={`${props.id}-o`} maskUnits="userSpaceOnUse" {...frame()}>
        <rect {...frame()} fill={REGION_MASK.outside.canvas} />
        <RegionOp op={props.paint.stock} fill={REGION_MASK.outside.stock} stroke="none" />
        <For each={props.paint.holes}>
          {(op) => <RegionOp op={op} fill={REGION_MASK.outside.hole} stroke="none" />}
        </For>
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

/** Overlay halo outside the CSG fill, same clip idea as `ChromeOutsideClip` on profiles. */
export function RegionHalo(props: {
  paint: RegionPaint;
  id: string;
  layers: ChromeLayer[];
  class: (layer: ChromeLayer) => InkClass;
  opacity?: (layer: ChromeLayer) => number | undefined;
  layerRole?: (layer: ChromeLayer) => string | undefined;
}) {
  const stroke = (layer: ChromeLayer) => ({
    class: props.class(layer),
    opacity: props.opacity?.(layer) ?? layer.opacity,
    "data-role": props.layerRole?.(layer),
    fill: "none" as const,
    "stroke-width": layerStrokeWidth(layer),
    "stroke-linecap": "round" as const,
    "stroke-linejoin": "round" as const,
    "vector-effect": "non-scaling-stroke" as const,
  });
  return (
    <>
      <RegionMaskDefs paint={props.paint} id={props.id} />
      <RegionClipped
        id={props.id}
        keepClip={props.paint.keepClip}
        islandClip={props.paint.islandClip}
      >
        <For each={props.layers}>
          {(layer) => (
            <>
              <RegionOp
                op={props.paint.stock}
                mask={regionOutsideStockUrl(props.id)}
                {...stroke(layer)}
              />
              <g mask={regionStockUrl(props.id)}>
                <For each={props.paint.holes}>
                  {(op) => (
                    <RegionOp op={op} mask={regionOutsideUrl(props.id)} {...stroke(layer)} />
                  )}
                </For>
              </g>
            </>
          )}
        </For>
      </RegionClipped>
    </>
  );
}
