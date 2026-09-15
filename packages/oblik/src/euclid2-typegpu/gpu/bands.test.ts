import { describe, expect, test } from "vitest";

import {
  chromeLayers,
  DEFAULT_CHROME_METRICS,
  overlayBands,
  POINT_STROKE_PX,
  type ChromeKind,
} from "../../euclid2/view/chrome";
import { chromePasses, splitChrome } from "../../euclid2/view/marks";
import {
  bandLayers,
  bandsFor,
  CIRCLE_BAND_LAYERS,
  INK_BAND_ORDER,
  INK_LAYER_COUNT,
  inkSlotOf,
  instancesPerEntry,
  makeChromeValue,
  POINT_BAND_LAYERS,
  POINT_RIM_EXTRA_PX,
  STROKE_BAND_LAYERS,
  type InkBandName,
  type InkState,
} from "./bands";
import {
  LAYER_COUNT,
  LAYER_HALO,
  LAYER_KNOCKOUT,
  LAYER_OUTLINE,
  LAYER_PAINT,
  STATE_EDITABLE,
  STATE_EXPLICIT,
  STATE_HOT,
  STATE_MUTED,
  STATE_SELECTED,
  type ChromeValue,
} from "./schemas";

/**
 * The band and colour contracts, held to the SVG view and to `docs/chrome.md`
 * rather than to fixtures: the SVG's chrome model is the specification, and a
 * contract that restates the implementation only proves the two agree.
 *
 * The failure these exist for is the one the prototype shipped: a stroke's rest
 * band asking for layer 0 — the halo — so every cold stroke drew a zero-width
 * band and nothing else. It is invisible in a unit test that reads the
 * implementation's own numbers, so the layer a band asks for is checked against
 * the SVG's pass order and its chrome recipe.
 */

/** Distinct per token, so a swapped palette entry cannot pass unnoticed. */
const COLORS = {
  ink: [0.01, 0.02, 0.03] as const,
  accent: [0.11, 0.12, 0.13] as const,
  selectedPaint: [0.21, 0.22, 0.23] as const,
  ring: [0.31, 0.32, 0.33] as const,
  paper: [0.41, 0.42, 0.43] as const,
};

const STROKE_PX = 1.5;
/** A node's paint half width, CSS px: the one number that is the record's, not
 * the frame's. */
const PAINT_HALF_PX = STROKE_PX / 2;

/** A `vec3f` stores f32, so a token arrives as its own rounded value — exact
 * enough to compare directly, and each token below is distinct enough that a
 * swapped palette entry cannot pass. */
const asTriple = (v: { x: number; y: number; z: number }) => [v.x, v.y, v.z];
const asF32 = (c: readonly number[]) => c.map(Math.fround);

const BAND_OF_PASS: Record<string, InkBandName> = {
  rest: "rest",
  hoverOverlay: "hoverHalo",
  hover: "hoverPaint",
  liftedOverlay: "liftedHalo",
  lifted: "liftedPaint",
};

/** The SVG's pass order (`chromePasses`) as band names, with one sentinel per
 * state so a pass can be told from its bucket. */
function svgBandOrder(halos: boolean): InkBandName[] {
  const band = splitChrome(
    [{ at: "rest" }],
    () => false,
    () => false,
  );
  const hovered = splitChrome(
    [{ at: "hover" }],
    () => false,
    () => true,
  );
  const lifted = splitChrome(
    [{ at: "lifted" }],
    () => true,
    () => true,
  );
  const passes = chromePasses(
    { rest: band.rest, hover: hovered.hover, lifted: lifted.lifted },
    halos,
  );
  return passes.map((pass) => {
    const which = (pass.items[0] as { at: string }).at;
    return BAND_OF_PASS[which + (pass.overlay ? "Overlay" : "")]!;
  });
}

/** The SVG's chrome recipe for one state: what kind of band it draws, how wide
 * and at what opacity. `overlay: false` is the paint pass. */
function svgChrome(
  state: InkState,
  paintWidth: number,
  point: boolean,
): { kind: ChromeKind; width: number; opacity: number }[] {
  const opts = { selected: state === "lifted", hover: state === "hover", point };
  const chrome = chromeLayers(paintWidth, { ...opts, overlay: true });
  const paint = chromeLayers(paintWidth, { ...opts, overlay: false });
  return [...chrome, ...paint].map((layer) => ({
    kind: layer.kind,
    width: layer.width,
    opacity: layer.opacity ?? 1,
  }));
}

/** What the GPU draws for a node in this state, from the band tables and the
 * chrome uniform: `(kind, widthPx, opacity)` triples. A state gates a layer to a
 * zero width rather than to a flag, so a dead band is simply dropped. */
function gpuChrome(
  kind: "strokes" | "points",
  state: InkState,
  chrome: ChromeValue,
  paintHalfPx: number,
): { layer: number; kind: ChromeKind; width: number; opacity: number }[] {
  const hot = state !== "rest";
  const selected = state === "lifted";
  const out: { layer: number; kind: ChromeKind; width: number; opacity: number }[] = [];
  for (const band of bandsFor(state, true)) {
    for (const layer of bandLayers(kind, band)) {
      if (layer === LAYER_PAINT) {
        out.push({ layer, kind: "paint", width: 2 * paintHalfPx, opacity: 1 });
      } else if (layer === LAYER_OUTLINE) {
        const half = paintHalfPx + chrome.pointOutlineAddPx;
        out.push({ layer, kind: "outline", width: 2 * half, opacity: 1 });
      } else if (layer === LAYER_HALO) {
        const half = kind === "strokes" ? chrome.haloHalfPx : paintHalfPx + chrome.pointRingAddPx;
        out.push({
          layer,
          kind: "outline",
          width: hot ? 2 * half : 0,
          opacity: selected ? chrome.selectAlpha : chrome.hoverAlpha,
        });
      } else {
        const half = kind === "strokes" ? chrome.knockHalfPx : paintHalfPx + chrome.pointKnockAddPx;
        out.push({ layer, kind: "knockout", width: selected ? 2 * half : 0, opacity: 1 });
      }
    }
  }
  return out.filter((layer) => layer.width > 0);
}

describe("band membership", () => {
  test("the band order is the SVG's pass order", () => {
    expect(svgBandOrder(true)).toEqual([...INK_BAND_ORDER]);
    expect(svgBandOrder(false)).toEqual(["rest", "hoverPaint", "liftedPaint"]);
  });

  test("a rest node joins the paint band only, never a halo", () => {
    // The prototype's bug, as an assertion: a cold node's bands carry the paint
    // layer and no chrome at all. A mark adds its paper rim, which is the SVG's
    // own paint stroke rather than a chrome layer.
    const expected: Record<string, readonly number[]> = {
      strokes: [LAYER_PAINT],
      circles: [LAYER_PAINT],
      points: [LAYER_OUTLINE, LAYER_PAINT],
    };
    expect(bandsFor("rest", true)).toEqual(["rest"]);
    for (const kind of ["strokes", "circles", "points"] as const) {
      const layers = bandLayers(kind, "rest");
      expect(layers).not.toContain(LAYER_HALO);
      expect(layers).not.toContain(LAYER_KNOCKOUT);
      expect(layers).toEqual(expected[kind]);
    }
  });

  test("a hot node paints after its chrome, and dragging drops the chrome", () => {
    expect(bandsFor("hover", true)).toEqual(["hoverHalo", "hoverPaint"]);
    expect(bandsFor("lifted", true)).toEqual(["liftedHalo", "liftedPaint"]);
    // Halos off while dragging: the paint still lifts, the rings do not appear.
    expect(bandsFor("hover", false)).toEqual(["hoverPaint"]);
    expect(bandsFor("lifted", false)).toEqual(["liftedPaint"]);
    // A band's chrome always sits under its own paint.
    for (const state of ["hover", "lifted"] as const) {
      const bands = bandsFor(state, true);
      expect(bands.indexOf(bands.find((b) => b.endsWith("Halo"))!)).toBeLessThan(
        bands.indexOf(bands.find((b) => b.endsWith("Paint"))!),
      );
    }
  });

  test("one entry is one instance, or one per layer", () => {
    // A pooled record is replayed once per layer of its band; a per-layer kind
    // names its own slot, so its entries count once.
    for (const band of INK_BAND_ORDER) {
      expect(instancesPerEntry("strokes", band)).toBe(STROKE_BAND_LAYERS[band]!.length);
      expect(instancesPerEntry("points", band)).toBe(POINT_BAND_LAYERS[band]!.length);
      expect(instancesPerEntry("circles", band)).toBe(1);
    }
    expect(instancesPerEntry("strokes", "rest")).toBe(1);
    expect(instancesPerEntry("strokes", "hoverHalo")).toBe(2);
    expect(instancesPerEntry("points", "rest")).toBe(2);
  });
});

describe("chrome widths", () => {
  test("the frame's chrome is the SVG's recipe, kind for kind", () => {
    const chrome = makeChromeValue(COLORS, STROKE_PX);
    // A 1.5px construction stroke: 7px outline / 4px knockout, halved for the
    // records, which store half widths (docs/chrome.md).
    const edges = overlayBands(STROKE_PX, { selected: true });
    expect(edges).toEqual({ outline: 7, knockout: 4 });
    expect(chrome.haloHalfPx).toBeCloseTo(edges.outline / 2, 9);
    expect(chrome.knockHalfPx).toBeCloseTo(edges.knockout / 2, 9);
    expect(chrome.hoverAlpha).toBe(DEFAULT_CHROME_METRICS.hoverOutlineOpacity);
    expect(chrome.selectAlpha).toBe(DEFAULT_CHROME_METRICS.selectOutlineOpacity);
  });

  test("a mark's bands are measured from its own radius, not from a stroke's", () => {
    const chrome = makeChromeValue(COLORS, STROKE_PX);
    // Points use a fixed wider halo (14px outline / 9px knockout) instead of
    // growing with the paint, so their offsets are the point metrics halved.
    const points = overlayBands(POINT_STROKE_PX, { selected: false, point: true });
    expect(points).toEqual({ outline: 14, knockout: 9 });
    expect(chrome.pointRingAddPx).toBeCloseTo(points.outline / 2, 9);
    expect(chrome.pointKnockAddPx).toBeCloseTo(points.knockout / 2, 9);
    // The paper rim is the SVG's own paint stroke, widened on the GPU by the
    // documented half pixel (a rim that reads thin on a 3.5px dot).
    expect(chrome.pointOutlineAddPx).toBeCloseTo(POINT_STROKE_PX / 2 + POINT_RIM_EXTRA_PX, 9);
    // No number is shared between the edge and the mark recipes by accident.
    expect(chrome.pointRingAddPx).not.toBeCloseTo(chrome.haloHalfPx, 3);
  });

  test("the palette is carried per token, not mixed up", () => {
    const chrome = makeChromeValue(COLORS, STROKE_PX);
    expect(asTriple(chrome.ink)).toEqual(asF32(COLORS.ink));
    expect(asTriple(chrome.accent)).toEqual(asF32(COLORS.accent));
    expect(asTriple(chrome.selectedPaint)).toEqual(asF32(COLORS.selectedPaint));
    expect(asTriple(chrome.ring)).toEqual(asF32(COLORS.ring));
    expect(asTriple(chrome.paper)).toEqual(asF32(COLORS.paper));
  });

  test("a missing value is loud, not a zero-width band", () => {
    // A NaN width draws nothing, which on screen is indistinguishable from a
    // dozen other bugs — so it throws instead.
    expect(() => makeChromeValue({ ...COLORS, ring: [Number.NaN, 0, 0] }, STROKE_PX)).toThrow(
      /ring\.r/,
    );
    expect(() => makeChromeValue(COLORS, Number.NaN)).toThrow(/haloHalfPx/);
  });
});

describe("state and layer numbering", () => {
  test("each state's effective layers are the SVG's chrome recipe", () => {
    const chrome = makeChromeValue(COLORS, STROKE_PX);
    for (const state of ["rest", "hover", "lifted"] as const) {
      // A stroke: the same widths and opacities the SVG strokes, layer for
      // layer, in the same order.
      const strokeLayers = gpuChrome("strokes", state, chrome, PAINT_HALF_PX).map(
        ({ kind, width, opacity }) => ({ kind, width, opacity }),
      );
      expect(strokeLayers).toEqual(svgChrome(state, STROKE_PX, false));

      // A mark's halo layers are the SVG's chrome kinds at the same opacities.
      // Their *widths* are not the SVG's: SVG strokes a 14px ring where the GPU
      // draws a full disc of `markR + 7` under the dot, which is why the
      // mark's recipe is asserted above, from its own radius.
      const gpu = gpuChrome("points", state, chrome, PAINT_HALF_PX);
      const svg = svgChrome(state, POINT_STROKE_PX, true);
      // The mark's own chrome is the halo pair; the rim and the paint are one
      // SVG layer and are asserted above, from the mark's radius.
      const gpuHalo = gpu
        .filter((layer) => layer.layer === LAYER_HALO || layer.layer === LAYER_KNOCKOUT)
        .map((layer) => [layer.kind, layer.opacity]);
      const svgHalo = svg
        .filter((layer) => layer.kind !== "paint")
        .map((layer) => [layer.kind, layer.opacity]);
      expect(gpuHalo).toEqual(svgHalo);
      // The rim+paint pair is the SVG's single paint layer: a paper disc under
      // the ink one, both at the mark's own alpha, in every state.
      expect(gpu.filter((layer) => layer.layer === LAYER_PAINT)).toHaveLength(1);
      expect(gpu.filter((layer) => layer.layer === LAYER_OUTLINE)).toHaveLength(1);
    }
  });

  test("the layer enum is the only numbering, and it is dense", () => {
    const layers = [LAYER_HALO, LAYER_KNOCKOUT, LAYER_OUTLINE, LAYER_PAINT];
    expect(layers).toEqual([0, 1, 2, 3]);
    expect(LAYER_COUNT).toBe(layers.length);
    expect(new Set(layers).size).toBe(LAYER_COUNT);
  });

  test("a circle maps the enum to its three slots, and refuses the rim", () => {
    expect(INK_LAYER_COUNT).toBe(3);
    expect([LAYER_HALO, LAYER_KNOCKOUT, LAYER_PAINT].map(inkSlotOf)).toEqual([0, 1, 2]);
    expect(() => inkSlotOf(LAYER_OUTLINE)).toThrow(/outline/);
    // Every circle band's layers are slots of its own three records.
    for (const band of INK_BAND_ORDER) {
      for (const layer of CIRCLE_BAND_LAYERS[band]!) {
        expect(inkSlotOf(layer)).toBeLessThan(INK_LAYER_COUNT);
      }
    }
  });

  test("the state bits are single, distinct bits", () => {
    const bits = [STATE_HOT, STATE_SELECTED, STATE_EDITABLE, STATE_MUTED, STATE_EXPLICIT];
    expect(bits).toEqual([1, 2, 4, 8, 16]);
    expect(new Set(bits).size).toBe(bits.length);
    // The explicit bit is what lets one schema carry both the overlay's own
    // colours and the scene's derived ones.
    expect(STATE_EXPLICIT & (STATE_HOT | STATE_SELECTED | STATE_EDITABLE | STATE_MUTED)).toBe(0);
  });
});
