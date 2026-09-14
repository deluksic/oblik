/**
 * One retained text, with the two operations kept apart on purpose.
 *
 * Glyph's own TypeGPU text folds a move into `update()`, which rebuilds the
 * paragraph: it spreads its retained options, hands the controller a new state
 * and re-shapes. That is the right cost for a *text* change and the wrong one
 * for a *position* change — and on a pan, every label changes position.
 *
 * So this text exposes the split explicitly:
 *
 * - {@link OblikText.update} — re-shape. Called only when the string, the style,
 *   the font, the layout or the constraints actually changed.
 * - {@link OblikText.setPlacement} — write three small uniforms. Called when a
 *   label moves, and never called for a camera move: the camera is one matrix
 *   the renderer owns and no text is involved.
 *
 * Functionally this is glyph's `createText` with the position uniform widened
 * from `vec2f` to the anchor/offset/ring records the shader reads, so the same
 * acquire/dispose discipline for fonts and controllers applies.
 */
import type {
  BorrowedGlyphLayout,
  Constraints,
  Font,
  FontFaceRasterOf,
  GlyphHandleFonts,
  GlyphLayoutInspection,
  GlyphRootServices,
  GlyphTextController,
  ParagraphLayout,
  ParagraphLayoutSummary,
  TextStyle,
} from "@pmndrs/glyph";
import type { TypeGpuFontSelection } from "@pmndrs/glyph/typegpu";

import type { OblikBindings, OblikMaterial, OblikRootContext, OblikTransform } from "./bindings";
import type { OblikRingInput } from "./instance";

export interface OblikTextOptions<Selection extends TypeGpuFontSelection = TypeGpuFontSelection> {
  readonly font: Selection;
  readonly text: string;
  readonly style?: TextStyle | undefined;
  readonly layout?: ParagraphLayout | undefined;
  readonly constraints?: Constraints | undefined;
  readonly rasterPixelRatio?: number | undefined;
}

/** Everything but placement: a change to any of these re-shapes the paragraph. */
export interface OblikTextUpdate<Selection extends TypeGpuFontSelection = TypeGpuFontSelection> {
  readonly font?: Selection | undefined;
  readonly text?: string | undefined;
  readonly style?: TextStyle | undefined;
  readonly layout?: ParagraphLayout | undefined;
  readonly constraints?: Constraints | undefined;
  readonly rasterPixelRatio?: number | undefined;
}

/** Where a label hangs: world anchor, screen offset, and its knockout band. */
export type OblikPlacement = {
  /** World point the label hangs off. The camera is applied to this. */
  readonly anchor: readonly [number, number];
  /** Screen-space offset in CSS px (y down) from the anchor to the text box. */
  readonly offset: readonly [number, number];
  readonly ring: OblikRingInput;
};

export interface OblikText<Selection extends TypeGpuFontSelection = TypeGpuFontSelection> {
  readonly disposed: boolean;
  /** Re-shape. Text, style, font, layout or constraints — never position. */
  update(update: OblikTextUpdate<Selection>): void;
  /** Move. Three uniform writes; no shaping, no layout, no allocation. */
  setPlacement(placement: OblikPlacement): void;
  measure(): ParagraphLayoutSummary;
  glyphs(): GlyphLayoutInspection;
  /** Reads indexed glyph data without copying full columns; expires on return. */
  withGlyphs<Result>(read: (glyphs: BorrowedGlyphLayout) => Result): Result;
  dispose(): void;
}

/** Write the placement records. The whole of what moving a label costs. */
function writePlacement(transform: OblikTransform, placement: OblikPlacement): void {
  const { anchor, offset, ring } = placement;
  transform.label.write([anchor[0], anchor[1], offset[0], offset[1]]);
  transform.ring.write([ring.gap, ring.enabled ? 1 : 0, 0, 0]);
  // A knockout band is the paper showing through, so it is always opaque.
  const [r, g, b] = ring.color;
  transform.ringColor.write([r, g, b, 1]);
}

export function createOblikText<Selection extends TypeGpuFontSelection>(
  fonts: GlyphHandleFonts,
  services: GlyphRootServices<OblikBindings, void, OblikRootContext>,
  transform: OblikTransform,
  options: OblikTextOptions<Selection>,
  placement: OblikPlacement,
  onDispose: () => void,
): OblikText<Selection> {
  if (options.style?.decoration !== undefined) {
    throw new TypeError("oblik text decoration lines are not supported");
  }
  let state = options;
  let font = fonts.acquire(options.font);
  let controller: GlyphTextController<FontFaceRasterOf<Selection>, OblikMaterial, OblikTransform>;
  let disposed = false;

  /** The shape-relevant half of the retained state; placement is not in it. */
  const coreState = (next: OblikTextOptions<Selection>, selected: Font<FontFaceRasterOf<Selection>>) => ({
    font: selected,
    text: next.text,
    transform,
    ...(next.style === undefined ? {} : { style: next.style }),
    ...(next.layout === undefined ? {} : { layout: next.layout }),
    ...(next.constraints === undefined ? {} : { constraints: next.constraints }),
    ...(next.rasterPixelRatio === undefined ? {} : { rasterPixelRatio: next.rasterPixelRatio }),
  });

  try {
    writePlacement(transform, placement);
    controller = services.createText(coreState(options, font));
  } catch (error) {
    font.dispose();
    throw error;
  }

  const assertActive = (): void => {
    if (disposed) throw new Error("oblik text is disposed");
  };

  return {
    get disposed() {
      return disposed;
    },
    update(update) {
      assertActive();
      const next = { ...state, ...update };
      if (next.style?.decoration !== undefined) {
        throw new TypeError("oblik text decoration lines are not supported");
      }
      const nextFont = next.font === state.font ? font : fonts.acquire(next.font);
      try {
        controller.update(coreState(next, nextFont));
      } catch (error) {
        if (nextFont !== font) nextFont.dispose();
        throw error;
      }
      if (nextFont !== font) font.dispose();
      font = nextFont;
      state = next;
    },
    setPlacement(next) {
      assertActive();
      writePlacement(transform, next);
    },
    measure() {
      assertActive();
      return controller.measure();
    },
    glyphs() {
      assertActive();
      return controller.inspect();
    },
    withGlyphs(read) {
      assertActive();
      return controller.withGlyphs(read);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      try {
        controller.dispose();
      } finally {
        font.dispose();
        // Accepted draws may still reference this transform until the next shape().
        onDispose();
      }
    },
  };
}
