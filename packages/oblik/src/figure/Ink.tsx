import { For, Show, createMemo } from "solid-js";

import type { TraceNode } from "../eval/context";
import type { FigureStyle } from "../eval/paint";
import { infiniteLineAxis } from "../geom/ops";
import { isGlider } from "../geom/gliders";
import { profileSvgPath } from "../geom/profile";
import { infiniteClip, type Camera2, type PaneSize } from "../euclid2/camera";
import { traceKey } from "../euclid2/pick";
import { chromeClipUrl, chromeLayers, chromeOutsideClipId, layerStrokeWidth, POINT_STROKE_PX, type ChromeKind, type ChromeLayer } from "../euclid2/view/chrome";
import { ChromeOutsideClip } from "../euclid2/view/ChromeClip";
import { readChromeMetrics } from "../euclid2/view/chrome-metrics";

import styles from "./View.module.css";

const ONION: FigureStyle = { kind: "style", stroke: "#8a8478", width: 1.05 };

function dash(s: FigureStyle): string | undefined {
  return s.dash && s.dash.length > 0 ? s.dash.join(" ") : undefined;
}

function layersOf(opts: { look: FigureStyle; onion: boolean; hot: boolean; selected: boolean; overlay?: boolean }): ChromeLayer[] {
  const w = (opts.onion ? ONION.width : opts.look.width) ?? 1.35;
  return chromeLayers(w, {
    selected: opts.selected,
    hover: opts.hot && !opts.selected,
    overlay: opts.overlay === true,
  }, readChromeMetrics());
}

function layerClass(kind: ChromeKind, muted: boolean, onion: boolean): string | Array<string | Record<string, boolean>> {
  if (kind === "knockout") return styles.knockout;
  if (kind === "outline") return styles.outline;
  return [styles.stroke, { [styles.muted]: muted && !onion }];
}

type StrokeProps = {
  look: FigureStyle;
  onion: boolean;
  hot: boolean;
  selected: boolean;
  muted: boolean;
  camera: Camera2;
  size: PaneSize;
  preview?: boolean;
  replaced?: boolean;
  overlay?: boolean;
  erase?: boolean;
};

/** `node` is `TraceNode | null` because Solid compiles JSX props as getters — a live preview can go null mid-update. */
export function FigureStroke(props: { node: TraceNode | null } & StrokeProps) {
  return (
    <Show when={props.node} keyed>
      {(node) => (
        <StrokeInk
          node={node}
          look={props.look}
          onion={props.onion}
          hot={props.hot}
          selected={props.selected}
          muted={props.muted}
          camera={props.camera}
          size={props.size}
          preview={props.preview}
          replaced={props.replaced}
          overlay={props.overlay}
          erase={props.erase}
        />
      )}
    </Show>
  );
}

function StrokeInk(props: { node: TraceNode } & StrokeProps) {
  const kind = createMemo(() => props.node.value.kind);
  const layers = createMemo(() =>
    layersOf({
      look: props.look,
      onion: props.onion,
      hot: props.hot,
      selected: props.selected,
      overlay: props.overlay,
    }),
  );
  return (
    <g class={{ [styles.preview]: props.preview === true, [styles.replaced]: props.replaced === true, [styles.erase]: props.erase === true }}>
      <Show when={kind() === "segment"}>
        <Seg node={props.node} look={props.look} onion={props.onion} muted={props.muted} overlay={props.overlay === true} layers={layers()} />
      </Show>
      <Show when={kind() === "line" || kind() === "parallelLine"}>
        <Inf
          node={props.node}
          look={props.look}
          onion={props.onion}
          muted={props.muted}
          overlay={props.overlay === true}
          layers={layers()}
          camera={props.camera}
          size={props.size}
        />
      </Show>
      <Show when={kind() === "circle"}>
        <Circ node={props.node} look={props.look} onion={props.onion} muted={props.muted} overlay={props.overlay === true} layers={layers()} />
      </Show>
      <Show when={kind() === "profile"}>
        <Face node={props.node} look={props.look} onion={props.onion} muted={props.muted} overlay={props.overlay === true} layers={layers()} />
      </Show>
    </g>
  );
}

function layerOpacity(layer: ChromeLayer, onion: boolean, onionPaint = 0.4): number | undefined {
  if (layer.opacity != null) return layer.opacity;
  if (onion && layer.kind === "paint") return onionPaint;
  return undefined;
}

function paintStroke(look: FigureStyle, layer: ChromeLayer): string | undefined {
  if (layer.kind !== "paint") return undefined;
  return look.stroke ?? "#1c1917";
}

function paintFill(look: FigureStyle, onion: boolean, layer: ChromeLayer, closed: boolean): string {
  if (layer.kind !== "paint") return "none";
  if (onion || !closed) return "none";
  return look.fill ?? "none";
}

function Seg(props: {
  node: TraceNode;
  look: FigureStyle;
  onion: boolean;
  muted: boolean;
  overlay: boolean;
  layers: ChromeLayer[];
}) {
  const s = createMemo(() => {
    const v = props.node?.value;
    return v?.kind === "segment" ? v : null;
  });
  const look = () => (props.onion ? ONION : props.look);
  return (
    <Show when={s()}>
      {(seg) => (
        <>
          {props.overlay ? null : (
            <line
              data-role="hit"
              class={styles.hit}
              data-ink={traceKey(props.node)}
              x1={seg().a.x}
              y1={seg().a.y}
              x2={seg().b.x}
              y2={seg().b.y}
            />
          )}
          <For each={props.layers}>
            {(layer) => (
              <line
                data-role={layer.kind === "paint" ? (props.onion ? "onion" : "paint") : layer.kind}
                class={layerClass(layer.kind, props.muted, props.onion)}
                opacity={layerOpacity(layer, props.onion)}
                fill="none"
                stroke={paintStroke(look(), layer)}
                stroke-width={layerStrokeWidth(layer)}
                stroke-dasharray={layer.kind === "paint" ? dash(look()) : undefined}
                stroke-linecap="round"
                vector-effect="non-scaling-stroke"
                x1={seg().a.x}
                y1={seg().a.y}
                x2={seg().b.x}
                y2={seg().b.y}
              />
            )}
          </For>
        </>
      )}
    </Show>
  );
}

function Circ(props: {
  node: TraceNode;
  look: FigureStyle;
  onion: boolean;
  muted: boolean;
  overlay: boolean;
  layers: ChromeLayer[];
}) {
  const c = createMemo(() => {
    const v = props.node?.value;
    return v?.kind === "circle" ? v : null;
  });
  const look = () => (props.onion ? ONION : props.look);
  return (
    <Show when={c()}>
      {(circ) => (
        <>
          {props.overlay ? null : (
            <circle
              data-role="hit"
              class={styles.hit}
              data-ink={traceKey(props.node)}
              cx={circ().center.x}
              cy={circ().center.y}
              r={Math.abs(circ().radius)}
            />
          )}
          <For each={props.layers}>
            {(layer) => (
              <circle
                data-role={layer.kind === "paint" ? (props.onion ? "onion" : "paint") : layer.kind}
                class={layerClass(layer.kind, props.muted, props.onion)}
                opacity={layerOpacity(layer, props.onion)}
                fill={paintFill(look(), props.onion, layer, true)}
                stroke={paintStroke(look(), layer)}
                stroke-width={layerStrokeWidth(layer)}
                stroke-dasharray={layer.kind === "paint" ? dash(look()) : undefined}
                vector-effect="non-scaling-stroke"
                cx={circ().center.x}
                cy={circ().center.y}
                r={Math.abs(circ().radius)}
              />
            )}
          </For>
        </>
      )}
    </Show>
  );
}

function Inf(props: {
  node: TraceNode;
  look: FigureStyle;
  onion: boolean;
  muted: boolean;
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
  const look = () => (props.onion ? ONION : props.look);
  return (
    <Show when={ends()}>
      {(e) => (
        <>
          {props.overlay ? null : (
            <line
              data-role="hit"
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
                data-role={layer.kind === "paint" ? (props.onion ? "onion" : "paint") : layer.kind}
                class={layerClass(layer.kind, props.muted, props.onion)}
                opacity={layerOpacity(layer, props.onion)}
                fill="none"
                stroke={paintStroke(look(), layer)}
                stroke-width={layerStrokeWidth(layer)}
                stroke-dasharray={layer.kind === "paint" ? dash(look()) : undefined}
                stroke-linecap="round"
                vector-effect="non-scaling-stroke"
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

function Face(props: {
  node: TraceNode;
  look: FigureStyle;
  onion: boolean;
  muted: boolean;
  overlay: boolean;
  layers: ChromeLayer[];
}) {
  const d = createMemo(() => {
    const v = props.node?.value;
    return v?.kind === "profile" ? profileSvgPath(v) : null;
  });
  const look = () => (props.onion ? ONION : props.look);
  const outsideId = () => chromeOutsideClipId(`fig-${traceKey(props.node)}${props.onion ? "-onion" : ""}`);
  return (
    <Show when={d()}>
      {(path) => (
        <>
          {props.overlay ? <ChromeOutsideClip id={outsideId()} d={path()} /> : null}
          {props.overlay ? null : <path data-role="hit" class={styles.hitFill} data-ink={traceKey(props.node)} d={path()} />}
          <For each={props.layers}>
            {(layer) => (
              <path
                data-role={layer.kind === "paint" ? (props.onion ? "onion" : "paint") : layer.kind}
                class={layerClass(layer.kind, props.muted, props.onion)}
                clip-path={props.overlay ? chromeClipUrl(outsideId()) : undefined}
                d={path()}
                fill={paintFill(look(), props.onion, layer, true)}
                stroke={paintStroke(look(), layer)}
                stroke-width={layerStrokeWidth(layer)}
                stroke-dasharray={layer.kind === "paint" ? dash(look()) : undefined}
                stroke-linecap="round"
                stroke-linejoin="round"
                vector-effect="non-scaling-stroke"
                opacity={layerOpacity(layer, props.onion, 0.35)}
              />
            )}
          </For>
        </>
      )}
    </Show>
  );
}

type PointProps = {
  look: FigureStyle | undefined;
  onion: boolean;
  hot: boolean;
  selected: boolean;
  muted: boolean;
  camera: Camera2;
  preview?: boolean;
  replaced?: boolean;
  overlay?: boolean;
  erase?: boolean;
};

/** Same live-getter contract as `FigureStroke`: `node` may go null while Brush preview unmounts. */
export function FigurePoint(props: { node: TraceNode | null } & PointProps) {
  return (
    <Show when={props.node} keyed>
      {(node) => (
        <PointInk
          node={node}
          look={props.look}
          onion={props.onion}
          hot={props.hot}
          selected={props.selected}
          muted={props.muted}
          camera={props.camera}
          preview={props.preview}
          replaced={props.replaced}
          overlay={props.overlay}
          erase={props.erase}
        />
      )}
    </Show>
  );
}

function PointInk(props: { node: TraceNode } & PointProps) {
  const at = createMemo(() => {
    const v = props.node?.value;
    if (v?.kind === "point") return v;
    if (v && isGlider(v)) return { x: v.x, y: v.y };
    return { x: 0, y: 0 };
  });
  const mark = () => (props.onion ? "open" : (props.look?.point ?? "dot"));
  const r = () => 5 / Math.max(12, props.camera.scale);
  const stroke = () =>
    props.onion ? ONION.stroke : (props.look?.stroke ?? "#1c1917");
  const fill = () => {
    if (props.onion || mark() === "open") return "none";
    return stroke();
  };
  const layers = createMemo(() =>
    chromeLayers(props.look?.width ?? POINT_STROKE_PX, {
      selected: props.selected,
      hover: props.hot && !props.selected,
      overlay: props.overlay === true,
      point: true,
    }, readChromeMetrics()),
  );
  return (
    <g class={{ [styles.preview]: props.preview === true, [styles.replaced]: props.replaced === true, [styles.erase]: props.erase === true }}>
      {mark() === "none" && !props.onion ? null : (
        <>
          {props.overlay ? null : (
            <circle
              data-role="hit"
              class={styles.hitFill}
              data-ink={traceKey(props.node)}
              cx={at().x}
              cy={at().y}
              r={r() * 2.4}
            />
          )}
          <For each={layers()}>
            {(layer) => (
              <circle
                data-role={layer.kind === "paint" ? (props.onion ? "onion" : "paint") : layer.kind}
                class={layer.kind === "paint" ? [styles.point, { [styles.muted]: props.muted }] : layerClass(layer.kind, props.muted, props.onion)}
                cx={at().x}
                cy={at().y}
                r={r()}
                fill={layer.kind === "paint" ? (fill() ?? "none") : "none"}
                stroke={layer.kind === "paint" ? stroke() : undefined}
                stroke-width={layerStrokeWidth(layer)}
                vector-effect="non-scaling-stroke"
                opacity={layerOpacity(layer, props.onion, 0.45)}
              />
            )}
          </For>
        </>
      )}
    </g>
  );
}
