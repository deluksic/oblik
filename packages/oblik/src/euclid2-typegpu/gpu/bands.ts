import { vec3f } from "typegpu/data";

import {
  DEFAULT_CHROME_METRICS,
  overlayBands,
  POINT_STROKE_PX,
  type ChromeMetrics,
} from "../../euclid2/view/chrome";
import {
  Chrome,
  LAYER_HALO,
  LAYER_KNOCKOUT,
  LAYER_OUTLINE,
  LAYER_PAINT,
  type ChromeValue,
} from "./schemas";

/**
 * The one place a band becomes layers, and the one place the chrome's widths
 * and palette are derived.
 *
 * A band is a *draw*, and the layer is a property of that draw rather than of
 * the record: one pooled stroke record is replayed by the paint band and by the
 * chrome pair, which is what lets a frame carry one record per node instead of
 * three. That is only safe while a single table says which layers a band
 * replays — two parallel numberings is how the rest band once asked for the
 * halo layer of a cold stroke and drew nothing at all.
 */

/** The five draw-order bands, in the order the painter plays them: rest paints,
 * hover chrome, hover paints, lifted chrome, lifted paints. That is the SVG's
 * `chromePasses` order, and holding to it is what keeps a hovered edge's chrome
 * under a selected edge's paint however the two shapes differ. */
export type InkBandName = "rest" | "hoverHalo" | "hoverPaint" | "liftedHalo" | "liftedPaint";

export const INK_BAND_ORDER: readonly InkBandName[] = [
  "rest",
  "hoverHalo",
  "hoverPaint",
  "liftedHalo",
  "liftedPaint",
];

/** Which draw state a node is in; see `splitChrome` in `euclid2/view/marks.ts`. */
export type InkState = "rest" | "hover" | "lifted";

export type InkKind = "strokes" | "circles" | "points";

/** The layers each band replays. A kind whose record carries every layer names
 * them here and one draw covers the band; a kind that keeps a record per layer
 * (circles) queues that layer's own slot through `inkSlotOf`, so for it this
 * table is about membership and order only. */
export const STROKE_BAND_LAYERS: Record<InkBandName, readonly number[]> = {
  rest: [LAYER_PAINT],
  hoverHalo: [LAYER_HALO, LAYER_KNOCKOUT],
  hoverPaint: [LAYER_PAINT],
  liftedHalo: [LAYER_HALO, LAYER_KNOCKOUT],
  liftedPaint: [LAYER_PAINT],
};

/** A mark's paint band is a *pair*: the paper rim is always on and sits under
 * the paint, so the two travel together in every paint pass. */
export const POINT_BAND_LAYERS: Record<InkBandName, readonly number[]> = {
  rest: [LAYER_OUTLINE, LAYER_PAINT],
  hoverHalo: [LAYER_HALO, LAYER_KNOCKOUT],
  hoverPaint: [LAYER_OUTLINE, LAYER_PAINT],
  liftedHalo: [LAYER_HALO, LAYER_KNOCKOUT],
  liftedPaint: [LAYER_OUTLINE, LAYER_PAINT],
};

export const CIRCLE_BAND_LAYERS: Record<InkBandName, readonly number[]> = {
  rest: [LAYER_PAINT],
  hoverHalo: [LAYER_HALO, LAYER_KNOCKOUT],
  hoverPaint: [LAYER_PAINT],
  liftedHalo: [LAYER_HALO, LAYER_KNOCKOUT],
  liftedPaint: [LAYER_PAINT],
};

export function bandLayers(kind: InkKind, band: InkBandName): readonly number[] {
  if (kind === "strokes") return STROKE_BAND_LAYERS[band];
  if (kind === "points") return POINT_BAND_LAYERS[band];
  return CIRCLE_BAND_LAYERS[band];
}

/** Where a node in this state draws. A rest node paints and nothing else; a hot
 * node's chrome bands exist only while halos are on, which is the SVG rule that
 * dragging lifts the paint and drops the rings. */
export function bandsFor(state: InkState, showHalos: boolean): InkBandName[] {
  if (state === "rest") return ["rest"];
  if (state === "hover") return showHalos ? ["hoverHalo", "hoverPaint"] : ["hoverPaint"];
  return showHalos ? ["liftedHalo", "liftedPaint"] : ["liftedPaint"];
}

/**
 * How many instances one order entry draws.
 *
 * A pooled record is addressed once per band and the band's layers are its
 * instances — adjacent by construction, so the shader derives its layer from the
 * instance's parity. A kind that keeps a record per layer names that layer's own
 * slot in the entry instead, so one entry is one instance.
 */
export function instancesPerEntry(kind: InkKind, band: InkBandName): number {
  return kind === "circles" ? 1 : bandLayers(kind, band).length;
}

/** A circle's records are per layer, so the shared enum needs a slot map: its
 * three records sit at 0/1/2 with no `outline` among them (a circle's rim is its
 * paint). The offset exists here and nowhere else. */
export const INK_LAYER_COUNT = 3;

export function inkSlotOf(layer: number): number {
  if (layer === LAYER_OUTLINE) throw new Error("a circle has no outline layer");
  return layer < LAYER_OUTLINE ? layer : layer - 1;
}

/** GPU-only visual tuning over the shared SVG point metrics: paint dots read
 * ~1 CSS px large on the GPU, so each paint radius is trimmed by 1 CSS px (most
 * visible on the wider draggable dots); the always-on paper rim under the paint
 * (the "normal knockout", POINT_STROKE_PX) reads thin on the GPU, so it is
 * widened by 0.5 CSS px. The selected knockout gap and the halo ring keep their
 * standard chrome widths. */
export const POINT_RADIUS_TRIM_PX = 1;
export const POINT_RIM_EXTRA_PX = 0.5;

/** Opacity of muted ink (chrome.mutePoints/scope) — the SVG's `.muted` element
 * opacity. The shaders derive it from the record's `STATE_MUTED` bit, so it is
 * a chrome number like any other rather than a constant in two shaders. */
export const MUTED_ALPHA = 0.32;

export type InkPalette = {
  ink: readonly [number, number, number];
  accent: readonly [number, number, number];
  selectedPaint: readonly [number, number, number];
  ring: readonly [number, number, number];
  paper: readonly [number, number, number];
};

/** Every number here lands in a uniform a shader culls or paints with, so a
 * missing one has to be loud: a band width of zero draws nothing, which is
 * indistinguishable from a dozen other bugs on screen. */
function finite(name: string, value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error(`chrome.${name} is not a finite number: ${value}`);
  }
  return value;
}

function token(colors: InkPalette, name: keyof InkPalette) {
  const [r, g, b] = colors[name];
  return vec3f(finite(`${name}.r`, r), finite(`${name}.g`, g), finite(`${name}.b`, b));
}

/**
 * The band widths and palette of one frame.
 *
 * The widths are the SVG's own chrome recipe, taken from `overlayBands` rather
 * than restated, and the point offsets are the same recipe measured from a
 * mark's paint radius: a band's width is a function of the chrome metrics and
 * the construction stroke, never of the node, which is why it can live in a
 * uniform that a theme switch rewrites and no record touches.
 */
export function makeChromeValue(
  colors: InkPalette,
  strokePx: number,
  metrics: ChromeMetrics = DEFAULT_CHROME_METRICS,
): ChromeValue {
  const { outline, knockout } = overlayBands(strokePx, { selected: true }, metrics);
  return Chrome({
    haloHalfPx: finite("haloHalfPx", outline / 2),
    knockHalfPx: finite("knockHalfPx", knockout / 2),
    pointRingAddPx: finite("pointRingAddPx", metrics.pointOutlinePx / 2),
    pointKnockAddPx: finite("pointKnockAddPx", metrics.pointKnockoutPx / 2),
    pointOutlineAddPx: finite("pointOutlineAddPx", POINT_STROKE_PX / 2 + POINT_RIM_EXTRA_PX),
    hoverAlpha: finite("hoverAlpha", metrics.hoverOutlineOpacity),
    selectAlpha: finite("selectAlpha", metrics.selectOutlineOpacity),
    mutedAlpha: MUTED_ALPHA,
    ink: token(colors, "ink"),
    accent: token(colors, "accent"),
    selectedPaint: token(colors, "selectedPaint"),
    ring: token(colors, "ring"),
    paper: token(colors, "paper"),
  });
}
