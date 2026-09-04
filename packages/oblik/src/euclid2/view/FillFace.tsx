import { For, Show, createMemo, type Accessor, type ParentProps } from "solid-js";

import type { Csg2, Pick as GeomPick, Polygon, Region } from "@/geom";
import { fillPaint, type CsgPaint, type DrawOp } from "@/geom/csg-draw";
import { isPick } from "@/geom/csg2";
import { evaluateRegions } from "@/geom/evaluate-regions";
import { polygonSvgPath } from "@/geom/polygon";
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
  value: Region | Csg2 | GeomPick | Polygon;
  overlay: boolean;
  layers: ChromeLayer[];
  uid: string;
  hit?: FaceInk;
  layer: (layer: ChromeLayer) => FaceInk;
  /** Figure shop-flatten also strokes CSG holes. Euclid2 paints stock only. */
  strokeHoles?: boolean;
};

type Declared = Region | Polygon;

function declaredFill(v: Region | Csg2 | GeomPick | Polygon): Declared | undefined {
  if (v.kind === "region" || v.kind === "polygon") return v;
  if (isPick(v)) {
    const islands = evaluateRegions(v);
    return islands.length === 1 ? islands[0]! : undefined;
  }
  return undefined;
}

function declaredPath(v: Declared): string {
  return v.kind === "polygon" ? polygonSvgPath(v) : regionSvgPath(v);
}

// FaceInk attribute bags are applied as explicit per-attribute props below —
// JSX spreads of computed objects would force Solid's Proxy merging, so the
// ink is threaded as an accessor and each attribute reads it reactively.

function RegionOpInk(props: { op: DrawOp; mask?: string; ink: Accessor<FaceInk | undefined> }) {
  const i = () => props.ink();
  return (
    <RegionOp
      op={props.op}
      mask={props.mask}
      class={i()?.class}
      fill={i()?.fill}
      stroke={i()?.stroke}
      stroke-width={i()?.["stroke-width"]}
      stroke-dasharray={i()?.["stroke-dasharray"]}
      stroke-linecap={i()?.["stroke-linecap"]}
      stroke-linejoin={i()?.["stroke-linejoin"]}
      vector-effect={i()?.["vector-effect"]}
      opacity={i()?.opacity}
      data-ink={i()?.["data-ink"]}
      data-role={i()?.["data-role"]}
    />
  );
}

function FacePath(props: { d: string; clip?: string; ink: Accessor<FaceInk | undefined> }) {
  const i = () => props.ink();
  return (
    <path
      d={props.d}
      fill-rule="evenodd"
      clip-path={props.clip}
      class={i()?.class}
      fill={i()?.fill}
      stroke={i()?.stroke}
      stroke-width={i()?.["stroke-width"]}
      stroke-dasharray={i()?.["stroke-dasharray"]}
      stroke-linecap={i()?.["stroke-linecap"]}
      stroke-linejoin={i()?.["stroke-linejoin"]}
      vector-effect={i()?.["vector-effect"]}
      opacity={i()?.opacity}
      data-ink={i()?.["data-ink"]}
      data-role={i()?.["data-role"]}
    />
  );
}

function TreeFill(props: { paint: CsgPaint; id: string; ink: Accessor<FaceInk | undefined> }) {
  const i = () => props.ink();
  return (
    <RegionTreeFill
      paint={props.paint}
      id={props.id}
      class={i()?.class}
      data-ink={i()?.["data-ink"]}
      data-role={i()?.["data-role"]}
      fill={i()?.fill}
      stroke={i()?.stroke}
      opacity={i()?.opacity}
    />
  );
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
        <RegionOpInk
          op={op}
          mask={props.mask}
          ink={() => (op === props.stock ? ink() : holeInk(ink()))}
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

function DeclaredFace(props: ParentProps<FillFaceProps & { value: Declared }>) {
  const d = () => declaredPath(props.value);
  const outsideId = () => chromeOutsideClipId(props.uid);
  return (
    <Show when={d()}>
      {(path) => (
        <>
          {props.overlay ? <ChromeOutsideClip id={outsideId()} d={path()} /> : undefined}
          {props.overlay || !props.hit ? undefined : <FacePath d={path()} ink={() => props.hit} />}
          <For each={props.layers}>
            {(layer) => (
              <FacePath
                d={path()}
                clip={props.overlay ? chromeClipUrl(outsideId()) : undefined}
                ink={() => props.layer(layer)}
              />
            )}
          </For>
          {props.overlay ? undefined : props.children}
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
                    <RegionOpInk
                      op={paint().stock}
                      mask={regionMaskUrl(id())}
                      ink={() => props.hit}
                    />
                  ) : undefined}
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
              {props.hit ? <TreeFill paint={paint()} id={id()} ink={() => props.hit} /> : undefined}
              <For each={props.layers}>
                {(layer) => <TreeFill paint={paint()} id={id()} ink={() => props.layer(layer)} />}
              </For>
            </Show>
          </RegionClipped>
          {props.children}
        </>
      )}
    </Show>
  );
}
