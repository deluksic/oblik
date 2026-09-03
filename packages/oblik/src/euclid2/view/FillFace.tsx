import { For, Show, createMemo, type ParentProps } from "solid-js";

import type { Csg2, Pick as GeomPick, Region } from "@/geom";
import { fillPaint, type DrawOp } from "@/geom/csg-draw";
import { isPick } from "@/geom/csg2";
import { evaluateRegions } from "@/geom/evaluate-regions";
import { regionSvgPath } from "@/geom/region";

import { chromeClipUrl, chromeOutsideClipId, type ChromeLayer } from "./chrome";
import { ChromeOutsideClip } from "./ChromeClip";
import {
  RegionClipped,
  RegionHalo,
  RegionMaskDefs,
  RegionOp,
  RegionTreeFill,
  regionMaskId,
  regionMaskUrl,
  type InkClass,
} from "./RegionInk";

export type FaceInk = {
  class?: InkClass;
  fill?: string;
  stroke?: string;
  "stroke-width"?: string | number;
  "stroke-dasharray"?: string;
  "stroke-linecap"?: "round" | "butt" | "square";
  "stroke-linejoin"?: "round" | "miter" | "bevel";
  "vector-effect"?: "non-scaling-stroke" | "none";
  opacity?: number;
  "data-ink"?: string;
  "data-role"?: string;
};

export type FillFaceProps = {
  value: Region | Csg2 | GeomPick;
  overlay: boolean;
  layers: ChromeLayer[];
  uid: string;
  hit?: FaceInk;
  layer: (layer: ChromeLayer) => FaceInk;
  /** Figure shop-flatten also strokes CSG holes. Euclid2 paints stock only. */
  strokeHoles?: boolean;
};

function declaredFill(v: Region | Csg2 | GeomPick): Region | null {
  if (v.kind === "region") return v;
  if (isPick(v)) {
    const islands = evaluateRegions(v);
    if (islands.length === 1) return islands[0]!;
  }
  return null;
}

function attrs(ink: FaceInk) {
  return {
    class: ink.class,
    fill: ink.fill,
    stroke: ink.stroke,
    "stroke-width": ink["stroke-width"],
    "stroke-dasharray": ink["stroke-dasharray"],
    "stroke-linecap": ink["stroke-linecap"],
    "stroke-linejoin": ink["stroke-linejoin"],
    "vector-effect": ink["vector-effect"],
    opacity: ink.opacity,
    "data-ink": ink["data-ink"],
    "data-role": ink["data-role"],
  };
}

function holeInk(ink: FaceInk): FaceInk {
  return { ...ink, fill: "none" };
}

function CsgLayerOps(props: {
  layer: ChromeLayer;
  inkOf: (layer: ChromeLayer) => FaceInk;
  stock: DrawOp;
  holes: DrawOp[];
  strokeHoles?: boolean;
  mask: string;
}) {
  const ink = createMemo(() => props.inkOf(props.layer));
  const ops = createMemo(() => (props.strokeHoles ? [props.stock, ...props.holes] : [props.stock]));
  return (
    <For each={ops()}>
      {(op) => (
        <RegionOp
          op={op}
          mask={props.mask}
          {...attrs(op === props.stock ? ink() : holeInk(ink()))}
        />
      )}
    </For>
  );
}

/** Shared region / CSG fill + overlay halo. Hosts pass layer class and paint. */
export function FillFace(props: ParentProps<FillFaceProps>) {
  const declared = createMemo(() => declaredFill(props.value));
  return (
    <Show when={declared()} fallback={<CsgFace {...props} />}>
      {(r) => <DeclaredFace {...props} value={r()} />}
    </Show>
  );
}

function DeclaredFace(props: FillFaceProps) {
  const d = () => (props.value.kind === "region" ? regionSvgPath(props.value) : "");
  const outsideId = () => chromeOutsideClipId(props.uid);
  return (
    <Show when={d()}>
      {(path) => (
        <>
          {props.overlay ? <ChromeOutsideClip id={outsideId()} d={path()} /> : null}
          {props.overlay || !props.hit ? null : (
            <path {...attrs(props.hit)} d={path()} fill-rule="evenodd" />
          )}
          <For each={props.layers}>
            {(layer) => (
              <path
                {...attrs(props.layer(layer))}
                clip-path={props.overlay ? chromeClipUrl(outsideId()) : undefined}
                d={path()}
                fill-rule="evenodd"
              />
            )}
          </For>
        </>
      )}
    </Show>
  );
}

function CsgFace(props: ParentProps<FillFaceProps>) {
  const paint = createMemo(() => fillPaint(props.value as Csg2 | GeomPick));
  const id = createMemo(() => regionMaskId(props.uid));
  return (
    <Show when={!paint().empty}>
      {props.overlay ? (
        <RegionHalo
          paint={paint()}
          id={id()}
          layers={props.layers}
          class={(layer) => props.layer(layer).class ?? ""}
          opacity={(layer) => props.layer(layer).opacity}
          layerRole={(layer) => props.layer(layer)["data-role"]}
        />
      ) : (
        <>
          <RegionMaskDefs paint={paint()} id={id()} />
          <RegionClipped id={id()} keepClip={paint().keepClip}>
            <Show
              when={paint().tree}
              fallback={
                <>
                  {props.hit ? (
                    <RegionOp op={paint().stock} mask={regionMaskUrl(id())} {...attrs(props.hit)} />
                  ) : null}
                  <For each={props.layers}>
                    {(layer) => (
                      <CsgLayerOps
                        layer={layer}
                        inkOf={props.layer}
                        stock={paint().stock}
                        holes={paint().holes}
                        strokeHoles={props.strokeHoles}
                        mask={regionMaskUrl(id())}
                      />
                    )}
                  </For>
                </>
              }
            >
              {props.hit ? (
                <RegionTreeFill paint={paint()} id={id()} {...treeAttrs(props.hit)} />
              ) : null}
              <For each={props.layers}>
                {(layer) => (
                  <RegionTreeFill paint={paint()} id={id()} {...treeAttrs(props.layer(layer))} />
                )}
              </For>
            </Show>
          </RegionClipped>
          {props.children}
        </>
      )}
    </Show>
  );
}

function treeAttrs(ink: FaceInk) {
  return {
    class: ink.class,
    "data-ink": ink["data-ink"],
    "data-role": ink["data-role"],
    fill: ink.fill,
    stroke: ink.stroke,
    opacity: ink.opacity,
  };
}
