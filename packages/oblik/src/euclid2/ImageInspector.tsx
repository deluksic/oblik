import { createSignal } from "solid-js";

import type { ImageRot, ImageValue } from "../eval/image";
import { NumberField } from "../figure/NumberField";
import { SidebarSection } from "../host/SelectionSidebar";
import type { ImageProps } from "../source/image-edit";
import { formatNum } from "../source/patch";

import { btn, secondary } from "../ui/button.module.css";
import styles from "./ImageInspector.module.css";

export type ImageInspectorProps = {
  /** The selected reference's authored props — the value *is* the source, so
   * every field here is what the scene file says. */
  value: ImageValue;
  /** Write leaves through the patch endpoint. */
  onPatch: (props: ImageProps) => void;
  /** Hand a picked file to the same import the paste and drop paths use. */
  onImport: (file: File) => void;
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
  const [fileEl, setFileEl] = createSignal<HTMLInputElement | undefined>(undefined);
  const width = () => props.value.targetSize.width;
  const height = () => props.value.targetSize.height;

  return (
    <SidebarSection title="Reference">
      <p class={styles.meta}>
        {props.value.imageSize.width} × {props.value.imageSize.height} px
        {props.value.anchor.x !== 0 || props.value.anchor.y !== 0
          ? ` · anchored at ${formatNum(props.value.anchor.x)}, ${formatNum(props.value.anchor.y)}`
          : ""}
      </p>
      <div class={styles.row}>
        <button
          type="button"
          class={[btn, secondary]}
          title="Rotate 90° anticlockwise"
          onClick={() => props.onPatch({ rot: turn(props.value.rot, -1) })}
        >
          ⟲
        </button>
        <button
          type="button"
          class={[btn, secondary]}
          title="Rotate 90° clockwise"
          onClick={() => props.onPatch({ rot: turn(props.value.rot, 1) })}
        >
          ⟳
        </button>
        <button
          type="button"
          class={[btn, secondary]}
          title="Mirror about the vertical centre axis"
          onClick={() => props.onPatch({ flip: props.value.flip ? 0 : 1 })}
        >
          ⇄
        </button>
      </div>
      <div class={styles.fields}>
        <NumberField
          label="x"
          value={props.value.world.x}
          onChange={(x) => props.onPatch({ "world.x": x })}
        />
        <NumberField
          label="y"
          value={props.value.world.y}
          onChange={(y) => props.onPatch({ "world.y": y })}
        />
        {width() !== undefined ? (
          <NumberField
            label="width"
            min={0}
            value={width()!}
            onChange={(w) => props.onPatch({ "targetSize.width": w })}
          />
        ) : (
          <NumberField
            label="height"
            min={0}
            value={height() ?? 0}
            onChange={(h) => props.onPatch({ "targetSize.height": h })}
          />
        )}
      </div>
      <Dial
        label="opacity"
        max={1}
        value={props.value.style.opacity}
        onChange={(opacity) => props.onPatch({ "style.opacity": opacity })}
      />
      <Dial
        label="saturation"
        max={4}
        value={props.value.style.saturation}
        onChange={(saturation) => props.onPatch({ "style.saturation": saturation })}
      />
      <Dial
        label="contrast"
        max={4}
        value={props.value.style.contrast}
        onChange={(contrast) => props.onPatch({ "style.contrast": contrast })}
      />
      <div class={styles.row}>
        <button
          type="button"
          class={[btn, secondary]}
          title="Import a reference"
          onClick={() => fileEl()?.click()}
        >
          Import image…
        </button>
      </div>
      <input
        ref={setFileEl}
        class={styles.file}
        type="file"
        accept="image/*"
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = "";
          if (file !== undefined) props.onImport(file);
        }}
      />
    </SidebarSection>
  );
}

/** A quarter turn from `rot`, which is what the buttons are for. */
function turn(rot: ImageRot, steps: number): ImageRot {
  const at = TURNS.indexOf(rot);
  return TURNS[((((at < 0 ? 0 : at) + steps) % TURNS.length) + TURNS.length) % TURNS.length]!;
}

/** One style dial: a range for the gesture, the number for the record. */
function Dial(props: {
  label: string;
  value: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <label class={styles.dial}>
      <span class={styles.dialLabel}>{props.label}</span>
      <input
        class={styles.range}
        type="range"
        min={0}
        max={props.max}
        step={0.01}
        value={props.value}
        onInput={(e) => props.onChange(Number(e.currentTarget.value))}
      />
      <span class={styles.dialValue}>{formatNum(props.value)}</span>
    </label>
  );
}
