import type { ImageRot, ImageValue } from "../eval/image";
import { NumberField } from "../figure/NumberField";
import { SidebarSection } from "../host/SelectionSidebar";
import type { ImageProps } from "../source/image-edit";
import { formatNum } from "../source/patch";

import styles from "./ImageInspector.module.css";

export type ImageInspectorProps = {
  /** The selected reference's authored props — the value *is* the source, so
   * every field here is what the scene file says. */
  value: ImageValue;
  /** Show a leaf edit live, without touching the source — what a range drag and
   * every keystroke in a field do. */
  onPreview: (props: ImageProps) => void;
  /** Write leaves to the source: once per gesture, on release or blur. */
  onCommit: (props: ImageProps) => void;
};

const TURNS: ImageRot[] = [0, 90, 180, 270];

/**
 * The reference inspector: the transform kit, in one section.
 *
 * Every control writes through the patch endpoint and nothing else — there is no
 * draft path for a reference (its numbers live inside an options object, out of
 * reach of the literal patcher) and no on-canvas handles, by design. What it
 * shows is the authored props rather than a resolved rect, which is why the
 * *stated* target side is the one that gets a field: a node written with only a
 * width keeps inferring its height, and the field that would freeze that is not
 * the one on offer.
 */
export function ImageInspector(props: ImageInspectorProps) {
  /** A button has no "drag": show it at once and write it once. */
  const act = (leaves: ImageProps) => {
    props.onPreview(leaves);
    props.onCommit(leaves);
  };
  const width = () => props.value.targetSize.width;
  const height = () => props.value.targetSize.height;

  return (
    <SidebarSection title="Reference">
      <div class={styles.stack}>
        <p class={styles.meta}>
          {props.value.imageSize.width} × {props.value.imageSize.height} px
          {props.value.anchor.x !== 0 || props.value.anchor.y !== 0
            ? ` · anchored at ${formatNum(props.value.anchor.x)}, ${formatNum(props.value.anchor.y)}`
            : ""}
        </p>
        <div class={styles.row}>
          <button
            type="button"
            class={styles.iconBtn}
            title="Rotate 90° anticlockwise"
            onClick={() => act({ rot: turn(props.value.rot, -1) })}
          >
            ⟲
          </button>
          <button
            type="button"
            class={styles.iconBtn}
            title="Rotate 90° clockwise"
            onClick={() => act({ rot: turn(props.value.rot, 1) })}
          >
            ⟳
          </button>
          <button
            type="button"
            class={styles.iconBtn}
            title="Mirror about the vertical centre axis"
            onClick={() => act({ flip: props.value.flip ? 0 : 1 })}
          >
            ⇄
          </button>
        </div>
        <div class={styles.params}>
          <NumberField
            label="x"
            value={props.value.world.x}
            onChange={(x) => props.onPreview({ "world.x": x })}
            onCommit={() => props.onCommit({ "world.x": props.value.world.x })}
          />
          <NumberField
            label="y"
            value={props.value.world.y}
            onChange={(y) => props.onPreview({ "world.y": y })}
            onCommit={() => props.onCommit({ "world.y": props.value.world.y })}
          />
          {width() !== undefined ? (
            <NumberField
              label="w"
              min={0}
              value={width()!}
              onChange={(w) => props.onPreview({ "targetSize.width": w })}
              onCommit={() => props.onCommit({ "targetSize.width": width() ?? 0 })}
            />
          ) : (
            <NumberField
              label="h"
              min={0}
              value={height() ?? 0}
              onChange={(h) => props.onPreview({ "targetSize.height": h })}
              onCommit={() => props.onCommit({ "targetSize.height": height() ?? 0 })}
            />
          )}
          {/* A node that states both sides keeps both: only an *inferred* side
              is left off, so writing the other does not freeze the aspect. */}
          {width() !== undefined && height() !== undefined ? (
            <NumberField
              label="h"
              min={0}
              value={height() ?? 0}
              onChange={(h) => props.onPreview({ "targetSize.height": h })}
              onCommit={() => props.onCommit({ "targetSize.height": height() ?? 0 })}
            />
          ) : undefined}
        </div>
        <div class={styles.dials}>
          <Dial
            label="opacity"
            max={1}
            value={props.value.style.opacity}
            onPreview={(opacity) => props.onPreview({ "style.opacity": opacity })}
            onCommit={() => props.onCommit({ "style.opacity": props.value.style.opacity })}
          />
          <Dial
            label="saturation"
            max={4}
            value={props.value.style.saturation}
            onPreview={(saturation) => props.onPreview({ "style.saturation": saturation })}
            onCommit={() => props.onCommit({ "style.saturation": props.value.style.saturation })}
          />
          <Dial
            label="contrast"
            max={4}
            value={props.value.style.contrast}
            onPreview={(contrast) => props.onPreview({ "style.contrast": contrast })}
            onCommit={() => props.onCommit({ "style.contrast": props.value.style.contrast })}
          />
        </div>
      </div>
    </SidebarSection>
  );
}

/** A quarter turn from `rot`, which is what the buttons are for. */
function turn(rot: ImageRot, steps: number): ImageRot {
  const at = TURNS.indexOf(rot);
  return TURNS[((((at < 0 ? 0 : at) + steps) % TURNS.length) + TURNS.length) % TURNS.length]!;
}

/**
 * One style dial: a range for the gesture, the number for the record.
 *
 * `input` fires continuously and only *previews* — the canvas follows the
 * thumb with no source write, because a write here would mean a file write and
 * a full HMR round per pointer event. `change` fires once, when the gesture
 * ends, and that is what commits.
 */
function Dial(props: {
  label: string;
  value: number;
  max: number;
  onPreview: (value: number) => void;
  onCommit: () => void;
}) {
  // Three siblings, not a wrapper: they land in the parent grid's columns, which
  // is what keeps every slider the same length and aligned.
  return (
    <>
      <span class={styles.dialLabel}>{props.label}</span>
      <input
        class={styles.range}
        type="range"
        min={0}
        max={props.max}
        step={0.01}
        value={props.value}
        onInput={(e) => props.onPreview(Number(e.currentTarget.value))}
        onChange={() => props.onCommit()}
      />
      <span class={styles.dialValue}>{formatNum(props.value)}</span>
    </>
  );
}
