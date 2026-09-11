import type { TraceNode } from "../eval/context";
import { snapImageRot, type ImageValue } from "../eval/image";
import { sameDrawValue } from "../eval/reuse-trace";
import type { ImageProps } from "../source/image-edit";

/**
 * Live reference edits, without a source write.
 *
 * A source patch costs a file write and a full HMR round — an 810 KB
 * annotations bundle re-parsed on the client, 32 user sources re-scanned, the
 * scene re-executed and everything re-evaluated — which is fine once per
 * gesture and hopeless once per pointer event. So a drag edits a **pane-local
 * override** instead: the tape the view draws and the inspector reads is the
 * evaluated one with one node's value swapped, and only the release reaches the
 * endpoint. The same mechanism is what drag-to-move needs, which is why it
 * lives here rather than inside the inspector.
 *
 * The override is **self-clearing**: once the evaluated value equals what was
 * previewed, the source has caught up and the node is handed back untouched. So
 * there is no "clear the preview" step to get wrong, and a slow patch cannot
 * flash the old value back on screen.
 */
export type ImageOverride = { id: string; occ: number; value: ImageValue };

/**
 * Apply patch leaves the way `source/image-edit.ts` writes them, to a value
 * instead of to source text — same leaves, same meaning, so a preview and the
 * write it commits to cannot disagree. `rot` and `flip` go through the same
 * normalisation the constructor uses, and a target side is only ever *added*,
 * never dropped: a node stating one side keeps inferring the other.
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

/** One node's value swapped for a previewed one — and only while it differs,
 * which is what makes the override clear itself when the source catches up. */
export function withImageOverride(
  trace: readonly TraceNode[],
  override: ImageOverride | undefined,
): TraceNode[] {
  if (override === undefined) return trace as TraceNode[];
  return trace.map((node) => {
    if (node.id !== override.id || node.occ !== override.occ) return node;
    if (node.value.kind !== "image" || sameDrawValue(node.value, override.value)) return node;
    return { ...node, value: override.value } as TraceNode;
  });
}
