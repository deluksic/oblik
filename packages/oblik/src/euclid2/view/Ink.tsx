import { For, Show, createMemo } from "solid-js";

import type { TraceNode } from "@/eval/context";
import type { Circle, Csg2, Pick, Region, Segment } from "@/geom";
import { fillPaint } from "@/geom/csg-draw";
import { isOffsetCsg, isCsg2 } from "@/geom/csg2";
import { infiniteLineAxis } from "@/geom/ops";
import { edgesSvgPath, walkSvgPath } from "@/geom/region";

import { infiniteClip, type Camera2, type PaneSize } from "../camera";
import { traceKey } from "../pick";
import type { Ghost } from "../tool";
import {
  CONSTRUCTION_STROKE_PX,
  chromeLayers,
  chromeLayersEqual,
  layerStrokeWidth,
  type ChromeKind,
  type ChromeLayer,
} from "./chrome";
import { readChromeMetrics } from "./chrome-metrics";
import { FillFace, type FaceInk } from "./FillFace";
import { RegionOp } from "./RegionInk";

import styles from "./View.module.css";

function inkClass(editable: boolean, muted = false, selected = false, hot = false) {
  const white = selected || hot;
  return [
    styles.ink,
    {
      [styles.editable]: editable && !white,
      [styles.muted]: muted && !white,
      [styles.selected]: white,
    },
  ];
}

function layerClass(
  kind: ChromeKind,
  editable: boolean,
  muted: boolean,
  selected = false,
  hot = false,
) {
  if (kind === "knockout") return styles.knockout;
  if (kind === "outline") return styles.outline;
  return inkClass(editable, muted, selected, hot);
}

function layersOf(hot: boolean, selected: boolean, overlay: boolean): ChromeLayer[] {
  return chromeLayers(
    CONSTRUCTION_STROKE_PX,
    {
      selected,
      hover: hot && !selected,
      overlay,
    },
    readChromeMetrics(),
  );
}

export function Stroke(props: {
  node: TraceNode;
  hot: boolean;
  selected: boolean;
  muted?: boolean;
  camera: Camera2;
  size: PaneSize;
  overlay?: boolean;
}) {
  const kind = createMemo(() => props.node.value.kind);
  const layers = createMemo(() => layersOf(props.hot, props.selected, props.overlay === true), {
    equals: chromeLayersEqual,
  });
  return (
    <>
      {kind() === "segment" ? (
        <SegmentStroke
          node={props.node}
          muted={props.muted}
          hot={props.hot}
          selected={props.selected}
          overlay={props.overlay === true}
          layers={layers()}
        />
      ) : null}
      {kind() === "line" || kind() === "parallelLine" ? (
        <InfiniteStroke
          node={props.node}
          muted={props.muted}
          hot={props.hot}
          selected={props.selected}
          overlay={props.overlay === true}
          layers={layers()}
          camera={props.camera}
          size={props.size}
        />
      ) : null}
      {kind() === "circle" ? (
        <CircleStroke
          node={props.node}
          muted={props.muted}
          hot={props.hot}
          selected={props.selected}
          overlay={props.overlay === true}
          layers={layers()}
        />
      ) : null}
    </>
  );
}

function SegmentStroke(props: {
  node: TraceNode;
  muted?: boolean;
  hot: boolean;
  selected: boolean;
  overlay: boolean;
  layers: ChromeLayer[];
}) {
  const s = () => props.node.value as Segment;
  return (
    <>
      {props.overlay ? null : (
        <line
          class={styles.hit}
          data-ink={traceKey(props.node)}
          x1={s().a.x}
          y1={s().a.y}
          x2={s().b.x}
          y2={s().b.y}
        />
      )}
      <For each={props.layers}>
        {(layer) => (
          <line
            class={layerClass(layer.kind, false, !!props.muted, props.selected, props.hot)}
            opacity={layer.opacity}
            stroke-width={layerStrokeWidth(layer)}
            x1={s().a.x}
            y1={s().a.y}
            x2={s().b.x}
            y2={s().b.y}
          />
        )}
      </For>
    </>
  );
}

function CircleStroke(props: {
  node: TraceNode;
  muted?: boolean;
  hot: boolean;
  selected: boolean;
  overlay: boolean;
  layers: ChromeLayer[];
}) {
  const c = () => props.node.value as Circle;
  return (
    <>
      {props.overlay ? null : (
        <circle
          class={styles.hit}
          data-ink={traceKey(props.node)}
          cx={c().center.x}
          cy={c().center.y}
          r={Math.abs(c().radius)}
        />
      )}
      <For each={props.layers}>
        {(layer) => (
          <circle
            class={layerClass(
              layer.kind,
              props.node.editable,
              !!props.muted,
              props.selected,
              props.hot,
            )}
            opacity={layer.opacity}
            stroke-width={layerStrokeWidth(layer)}
            cx={c().center.x}
            cy={c().center.y}
            r={Math.abs(c().radius)}
          />
        )}
      </For>
    </>
  );
}

function InfiniteStroke(props: {
  node: TraceNode;
  muted?: boolean;
  hot: boolean;
  selected: boolean;
  overlay: boolean;
  layers: ChromeLayer[];
  camera: Camera2;
  size: PaneSize;
}) {
  const ends = createMemo(() => {
    const axis = infiniteLineAxis(props.node?.value);
    if (!axis) return null;
    return infiniteClip(axis.origin, axis.dir, props.camera, props.size);
  });
  const editable = () => props.node?.value.kind === "parallelLine" && !!props.node.editable;
  return (
    <Show when={ends()}>
      {(e) => (
        <>
          {props.overlay ? null : (
            <line
              class={styles.hit}
              data-ink={traceKey(props.node)}
              x1={e().a.x}
              y1={e().a.y}
              x2={e().b.x}
              y2={e().b.y}
            />
          )}
          <For each={props.layers}>
            {(layer) => (
              <line
                class={layerClass(layer.kind, editable(), !!props.muted, props.selected, props.hot)}
                opacity={layer.opacity}
                stroke-width={layerStrokeWidth(layer)}
                x1={e().a.x}
                y1={e().a.y}
                x2={e().b.x}
                y2={e().b.y}
              />
            )}
          </For>
        </>
      )}
    </Show>
  );
}

function constructionFaceLayer(layer: ChromeLayer): FaceInk {
  if (layer.kind === "paint") {
    return { class: styles.fill };
  }
  return {
    class: layerClass(layer.kind, false, false),
    fill: "none",
    "stroke-width": layerStrokeWidth(layer),
    opacity: layer.opacity,
  };
}

export function RegionFill(props: { node: TraceNode; hot: boolean; selected: boolean }) {
  const layers = createMemo(() => layersOf(props.hot, props.selected, false), {
    equals: chromeLayersEqual,
  });
  const value = () => props.node.value as Region | Csg2 | Pick;
  const offsetStock = createMemo(() => {
    const v = value();
    if (!isCsg2(v) || !isOffsetCsg(v)) return null;
    return fillPaint(v).stock;
  });
  return (
    <FillFace
      value={value()}
      overlay={false}
      layers={layers()}
      uid={`e2-${traceKey(props.node)}`}
      layer={(layer) => {
        const ink = constructionFaceLayer(layer);
        return {
          ...ink,
          class:
            layer.kind === "paint"
              ? [styles.fill, { [styles.selected]: props.selected || props.hot }]
              : ink.class,
          "data-ink": layer.kind === "paint" ? traceKey(props.node) : undefined,
        };
      }}
    >
      <Show when={offsetStock()}>
        {(op) => (
          <>
            <RegionOp op={op()} class={styles.hit} data-ink={traceKey(props.node)} fill="none" />
            <RegionOp
              op={op()}
              class={inkClass(props.node.editable, false, props.selected, props.hot)}
              fill="none"
            />
          </>
        )}
      </Show>
    </FillFace>
  );
}

export function RegionOutline(props: {
  node: TraceNode;
  hot: boolean;
  selected: boolean;
  overlay?: boolean;
}) {
  const layers = createMemo(() => layersOf(props.hot, props.selected, props.overlay === true), {
    equals: chromeLayersEqual,
  });
  return (
    <FillFace
      value={props.node.value as Region | Csg2 | Pick}
      overlay={props.overlay === true}
      layers={layers()}
      uid={`e2o-${traceKey(props.node)}`}
      layer={(layer) => constructionFaceLayer(layer)}
    />
  );
}

export function RegionGhost(props: { ghost: Extract<Ghost, { kind: "region" }>; camera: Camera2 }) {
  const chain = createMemo(() => {
    const g = props.ghost;
    if (g.loops && g.loops.length > 0) {
      return g.loops.map((w) => walkSvgPath(w, false)).join(" ");
    }
    const edges = g.hover ? [...g.edges, g.hover] : g.edges;
    return edgesSvgPath(edges, false);
  });
  const fill = createMemo(() => {
    const g = props.ghost;
    if (g.loops && g.loops.length > 0) {
      return g.loops.map((w) => walkSvgPath(w, true)).join(" ");
    }
    if (g.edges.length < 2) return "";
    return edgesSvgPath(g.edges, true);
  });
  const arrow = createMemo(() => {
    const a = props.ghost.arrow;
    if (!a) return null;
    const n = Math.hypot(a.tx, a.ty) || 1;
    const ux = a.tx / n;
    const uy = a.ty / n;
    const scale = Math.max(8, props.camera.scale);
    const pad = 10 / scale;
    const shaft = 20 / scale;
    const head = 7 / scale;
    const tail = { x: a.at.x + ux * pad, y: a.at.y + uy * pad };
    const tip = { x: tail.x + ux * shaft, y: tail.y + uy * shaft };
    const left = {
      x: tip.x - ux * head - uy * head * 0.62,
      y: tip.y - uy * head + ux * head * 0.62,
    };
    const right = {
      x: tip.x - ux * head + uy * head * 0.62,
      y: tip.y - uy * head - ux * head * 0.62,
    };
    return { tail, tip, left, right };
  });
  return (
    <g pointer-events="none">
      {fill() ? <path class={styles.ghostFill} d={fill()} /> : null}
      {chain() ? <path class={styles.ghost} d={chain()} fill="none" /> : null}
      {arrow() ? (
        <>
          <line
            class={styles.ghostArrow}
            x1={arrow()!.tail.x}
            y1={arrow()!.tail.y}
            x2={arrow()!.tip.x}
            y2={arrow()!.tip.y}
          />
          <polygon
            class={styles.ghostArrowHead}
            points={`${arrow()!.tip.x},${arrow()!.tip.y} ${arrow()!.left.x},${arrow()!.left.y} ${arrow()!.right.x},${arrow()!.right.y}`}
          />
        </>
      ) : null}
    </g>
  );
}
