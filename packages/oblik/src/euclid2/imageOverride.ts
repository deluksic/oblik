import type { TraceNode } from "../eval/context";
import { snapImageRot, type ImageValue } from "../eval/image";
import { sameDrawValue } from "../eval/reuse-trace";
import type { ImageProps } from "../source/image-edit";

/** A live edit that has not reached the source: one node's value swapped in the
 * evaluated tape, so a drag previews without a write. `from` is the source value
 * the preview started from — the override applies only while the source still
 * says it, so anything else that changes the source wins over a live preview. */
export type ImageOverride = {
  id: string;
  occ: number;
  from: ImageValue;
  value: ImageValue;
};

/**
 * Patch leaves applied to a value the way `source/image-edit.ts` applies them to
 * source text — same leaves, same meaning, so a preview and the write it
 * commits to cannot disagree.
 */
export function applyImageLeaves(value: ImageValue, leaves: ImageProps): ImageValue {
  const width = leaves["targetSize.width"];
  const height = leaves["targetSize.height"];
  return {
    ...value,
    src: leaves.src ?? value.src,
    world: { x: leaves["world.x"] ?? value.world.x, y: leaves["world.y"] ?? value.world.y },
    anchor: {
      x: leaves["anchor.x"] ?? value.anchor.x,
      y: leaves["anchor.y"] ?? value.anchor.y,
    },
    imageSize: {
      width: leaves["imageSize.width"] ?? value.imageSize.width,
      height: leaves["imageSize.height"] ?? value.imageSize.height,
    },
    targetSize: {
      ...(width !== undefined
        ? { width }
        : value.targetSize.width !== undefined
          ? { width: value.targetSize.width }
          : {}),
      ...(height !== undefined
        ? { height }
        : value.targetSize.height !== undefined
          ? { height: value.targetSize.height }
          : {}),
    },
    rot: snapImageRot(leaves.rot ?? value.rot),
    flip: (leaves.flip ?? value.flip) ? 1 : 0,
    style: {
      opacity: leaves["style.opacity"] ?? value.style.opacity,
      saturation: leaves["style.saturation"] ?? value.style.saturation,
      contrast: leaves["style.contrast"] ?? value.style.contrast,
    },
  };
}

/** One node's value swapped for a previewed one — and only while the source
 * still says what the preview started from. That is what makes the override
 * clear itself when the source catches up, and what stops it from masking a
 * source it did not come from: an edit in the file, or a point the reference is
 * tied to moving under it. */
export function withImageOverride(
  trace: readonly TraceNode[],
  override: ImageOverride | undefined,
): TraceNode[] {
  if (override === undefined) return trace as TraceNode[];
  return trace.map((node) => {
    if (node.id !== override.id || node.occ !== override.occ) return node;
    if (node.value.kind !== "image") return node;
    if (!sameDrawValue(node.value, override.from)) return node;
    if (sameDrawValue(node.value, override.value)) return node;
    return { ...node, value: override.value } as TraceNode;
  });
}
