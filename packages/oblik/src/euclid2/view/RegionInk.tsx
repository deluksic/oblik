import { For, Show, type ParentProps } from "solid-js";

import {
  csgTreeSvg,
  paintSvgPath,
  REGION_MASK,
  type CsgDraw,
  type CsgPaint,
  type DrawOp,
} from "@/geom/csg-draw";

import { chromeClipUrl, layerStrokeWidth, type ChromeLayer } from "./chrome";
import { ChromeOutsideClip } from "./ChromeClip";

export type InkClass = string | Array<string | Record<string, boolean>> | Record<string, boolean>;

function clipUrl(id: string): string {
  return `url(#${id})`;
}

export function regionMaskId(id: string): string {
  return `reg-${id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

export function regionMaskUrl(id: string): string {
  return clipUrl(`${id}-m`);
}

export function RegionMaskDefs(props: { paint: CsgPaint; id: string }) {
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
        <rect
          x={box().minX}
          y={box().minY}
          width={w()}
          height={h()}
          fill={REGION_MASK.fill.canvas}
        />
        <Show
          when={props.paint.tree}
          fallback={<RegionOp op={props.paint.stock} fill={REGION_MASK.fill.stock} stroke="none" />}
        >
          {(tree) => <CsgTreeInk node={tree()} uid={`${props.id}-t`} box={props.paint.box} />}
        </Show>
      </mask>
      <Show when={props.paint.keepClip}>
        {(d) => (
          <clipPath id={`${props.id}-k`} clipPathUnits="userSpaceOnUse">
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
  }>,
) {
  return (
    <>
      {props.keepClip ? (
        <g clip-path={clipUrl(`${props.id}-k`)}>{props.children}</g>
      ) : (
        props.children
      )}
    </>
  );
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
  return (
    <Show
      when={props.op.kind === "circle" ? props.op : undefined}
      fallback={
        <path
          d={props.op.kind === "path" ? props.op.d : ""}
          fill-rule="evenodd"
          fill={props.fill}
          stroke={props.stroke}
          mask={props.mask}
          class={props.class}
          opacity={props.opacity}
          stroke-width={props["stroke-width"]}
          stroke-dasharray={props["stroke-dasharray"]}
          stroke-linecap={props["stroke-linecap"]}
          stroke-linejoin={props["stroke-linejoin"]}
          vector-effect={props["vector-effect"]}
          data-ink={props["data-ink"]}
          data-role={props["data-role"]}
          clip-path={props["clip-path"]}
        />
      }
    >
      {(c) => (
        <circle
          cx={c().cx}
          cy={c().cy}
          r={c().r}
          fill={props.fill}
          stroke={props.stroke}
          mask={props.mask}
          class={props.class}
          opacity={props.opacity}
          stroke-width={props["stroke-width"]}
          stroke-dasharray={props["stroke-dasharray"]}
          stroke-linecap={props["stroke-linecap"]}
          stroke-linejoin={props["stroke-linejoin"]}
          vector-effect={props["vector-effect"]}
          data-ink={props["data-ink"]}
          data-role={props["data-role"]}
          clip-path={props["clip-path"]}
        />
      )}
    </Show>
  );
}

function CsgTreeInk(props: { node: CsgDraw; uid: string; box: CsgPaint["box"] }) {
  const bits = () => csgTreeSvg(props.node, props.uid, props.box);
  return (
    <>
      {/* innerHTML is our own generated CSG markup (csgTreeSvg), not user input. */}
      {/* oxlint-disable-next-line solid/no-innerhtml */}
      <g innerHTML={bits().defs} />
      {/* oxlint-disable-next-line solid/no-innerhtml */}
      <g innerHTML={bits().body} />
    </>
  );
}

export function RegionTreeFill(props: {
  paint: CsgPaint;
  id: string;
  class?: InkClass;
  "data-ink"?: string;
  "data-role"?: string;
  fill?: string;
  stroke?: string;
  opacity?: number;
}) {
  const box = () => props.paint.box;
  return (
    <rect
      x={box().minX}
      y={box().minY}
      width={box().maxX - box().minX}
      height={box().maxY - box().minY}
      mask={regionMaskUrl(props.id)}
      class={props.class}
      data-ink={props["data-ink"]}
      data-role={props["data-role"]}
      fill={props.fill}
      stroke={props.stroke ?? "none"}
      opacity={props.opacity}
    />
  );
}

/** Overlay halo outside the fill, including hole boundaries, via one even-odd path. */
export function RegionHalo(props: {
  paint: CsgPaint;
  id: string;
  layers: ChromeLayer[];
  class: (layer: ChromeLayer) => InkClass;
  opacity?: (layer: ChromeLayer) => number | undefined;
  layerRole?: (layer: ChromeLayer) => string | undefined;
}) {
  const d = () => paintSvgPath(props.paint);
  const outsideId = () => `${props.id}-out`;
  return (
    <Show when={!props.paint.tree && d()}>
      <ChromeOutsideClip id={outsideId()} d={d()} />
      <RegionClipped id={props.id} keepClip={props.paint.keepClip}>
        <For each={props.layers}>
          {(layer) => (
            <path
              d={d()}
              fill-rule="evenodd"
              clip-path={chromeClipUrl(outsideId())}
              class={props.class(layer)}
              opacity={props.opacity?.(layer) ?? layer.opacity}
              data-role={props.layerRole?.(layer)}
              fill="none"
              stroke-width={layerStrokeWidth(layer)}
              stroke-linecap="round"
              stroke-linejoin="round"
              vector-effect="non-scaling-stroke"
            />
          )}
        </For>
      </RegionClipped>
    </Show>
  );
}
