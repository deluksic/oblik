import { sizeOf } from "typegpu/data";
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
  chromeBands,
  CIRCLE_BAND_LAYERS,
  edgeBandHalves,
  INK_BAND_ORDER,
  INK_LAYER_COUNT,
  inkSlotOf,
  instancesPerEntry,
  makeChromeValue,
  MUTED_ALPHA,
  POINT_BAND_LAYERS,
  POINT_RIM_EXTRA_PX,
  STROKE_BAND_LAYERS,
  type InkBandName,
  type InkState,
} from "./bands";
import {
  Chrome,
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
 * zero width rather than to a flag, so a dead band is simply dropped.
 *
 * The widths are placed the way the two shaders place them — an edge from its
 * paint half width, a mark from its paper rim — so the numbers this reads back
 * are the ones `pipelines/wgsl.test.ts` pins as generated WGSL. */
function gpuChrome(
  kind: "strokes" | "points",
  state: InkState,
  chrome: ChromeValue,
  paintHalfPx: number,
): { layer: number; kind: ChromeKind; width: number; opacity: number }[] {
  const hot = state !== "rest";
  const selected = state === "lifted";
  const shared = { gapPx: chrome.gapPx, ringPx: chrome.ringPx };
  const edges = edgeBandHalves(paintHalfPx, shared, state);
  const rimPx = paintHalfPx + chrome.pointOutlineAddPx;
  const points = edgeBandHalves(rimPx, shared, state);
  const out: { layer: number; kind: ChromeKind; width: number; opacity: number }[] = [];
  for (const band of bandsFor(state, true)) {
    for (const layer of bandLayers(kind, band)) {
      if (layer === LAYER_PAINT) {
        out.push({ layer, kind: "paint", width: 2 * paintHalfPx, opacity: 1 });
      } else if (layer === LAYER_OUTLINE) {
        out.push({ layer, kind: "outline", width: 2 * rimPx, opacity: 1 });
      } else if (layer === LAYER_HALO) {
        const half = (kind === "strokes" ? edges : points).haloHalfPx;
        out.push({
          layer,
          kind: "outline",
          width: hot ? 2 * half : 0,
          opacity: selected ? chrome.selectAlpha : chrome.hoverAlpha,
        });
      } else {
        const half = (kind === "strokes" ? edges : points).knockHalfPx;
        out.push({ layer, kind: "knockout", width: selected ? 2 * half : 0, opacity: 1 });
      }
    }
  }
  return out.filter((layer) => layer.width > 0);
}

/** The visible chrome a kind shows, in CSS px from its own paint edge: the two
 * numbers a viewer reads off the screen. Both kinds are placed by the same helper,
 * so this is where the "one gap, one ring" claim is checked as geometry rather
 * than as a uniform's fields. */
function visibleChrome(
  kind: "strokes" | "points",
  state: InkState,
  chrome: ChromeValue,
  paintHalfPx: number,
): { gapPx: number; ringPx: number } {
  const rimPx = paintHalfPx + chrome.pointOutlineAddPx;
  const paint = kind === "strokes" ? paintHalfPx : rimPx;
  // A state that queues no chrome band draws none, so there is nothing to read.
  if (!bandsFor(state, true).some((band) => band.endsWith("Halo"))) {
    return { gapPx: 0, ringPx: 0 };
  }
  const halves = edgeBandHalves(paint, { gapPx: chrome.gapPx, ringPx: chrome.ringPx }, state);
  // The ring's inner edge is the paint's, or the paper's when a selection has
  // inserted the gap between them.
  const inner = state === "lifted" ? halves.knockHalfPx : paint;
  // Both bands are measured from the kind's own paint edge — a stroke's half
  // width, a mark's rim — which is why the two are comparable at all.
  return { gapPx: halves.knockHalfPx - paint, ringPx: halves.haloHalfPx - inner };
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
  test("the tokens are read as band widths, and the frame carries exactly one pair", () => {
    const chrome = makeChromeValue(COLORS, STROKE_PX);
    // A 1.5px construction stroke: 7px outline / 4px knockout (docs/chrome.md).
    // Both tokens are *widths* — the ring across, the gap across — so a band is
    // half its token. The bug this contract exists for: reading them as the outer
    // diameters of the bands for edges and marks but as thicknesses for fills
    // showed a 1.25px gap and a 1.5px ring on a selected line, 3px and 2.5px on a
    // point, and 2px and 3.5px on a fill — three answers to one question.
    const edges = overlayBands(STROKE_PX, { selected: true });
    expect(edges).toEqual({ outline: 7, knockout: 4 });
    const shared = chromeBands(STROKE_PX);
    expect(shared).toEqual({ gapPx: 2, ringPx: 3.5 });

    // There is no second reading of the tokens: the uniform *is* the pair, so a
    // kind cannot disagree with another about either number.
    expect({ gapPx: chrome.gapPx, ringPx: chrome.ringPx }).toEqual(shared);
    // A mark keeps its own rim, and nothing else of its own chrome.
    expect(chrome.pointOutlineAddPx).toBeCloseTo(POINT_STROKE_PX / 2 + POINT_RIM_EXTRA_PX, 9);

    // The palette and opacities are the SVG's, token for token.
    expect(chrome.hoverAlpha).toBe(DEFAULT_CHROME_METRICS.hoverOutlineOpacity);
    expect(chrome.selectAlpha).toBe(DEFAULT_CHROME_METRICS.selectOutlineOpacity);
    expect(chrome.mutedAlpha).toBeCloseTo(MUTED_ALPHA, 6);
  });

  test("hovering shows the ring alone; selecting inserts the gap and pushes it out", () => {
    const chrome = makeChromeValue(COLORS, STROKE_PX);
    const shared = chromeBands(STROKE_PX);
    for (const kind of ["strokes", "points"] as const) {
      for (const state of ["hover", "lifted"] as const) {
        // Every kind, hovered or selected, shows the same two numbers...
        expect(visibleChrome(kind, state, chrome, PAINT_HALF_PX)).toEqual(shared);
      }
      // ...and a hovered ring is not the fat one: it stops where a selected
      // one's paper starts, because the gap is what separates them.
      const hover = visibleChrome(kind, "hover", chrome, PAINT_HALF_PX);
      const lifted = visibleChrome(kind, "lifted", chrome, PAINT_HALF_PX);
      expect(hover.ringPx).toBeCloseTo(lifted.ringPx, 9);
      const paintHalf =
        kind === "strokes" ? PAINT_HALF_PX : PAINT_HALF_PX + chrome.pointOutlineAddPx;
      expect(paintHalf + hover.ringPx).toBeLessThan(paintHalf + lifted.gapPx + lifted.ringPx);
    }
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
    expect(() => makeChromeValue(COLORS, Number.NaN)).toThrow(/chrome\.gapPx/);
  });
});

describe("state and layer numbering", () => {
  test("each state's effective layers are the SVG's chrome recipe", () => {
    const chrome = makeChromeValue(COLORS, STROKE_PX);
    for (const state of ["rest", "hover", "lifted"] as const) {
      // A stroke: the SVG's chrome kinds, in its order, at its opacities. The
      // *widths* are the GPU's own: an SVG band is a stroke centred on the path,
      // so `outline: 7px, knockout: 4px` leaves a 1.25px gap and a 1.5px ring,
      // while a record places the bands from the paint edge outward (the same
      // 2px gap and 3.5px ring a selected fill shows). Which bands appear and how
      // strong they are is still the SVG's recipe, which is what this asserts.
      const strokeLayers = gpuChrome("strokes", state, chrome, PAINT_HALF_PX).map(
        ({ kind, opacity }) => ({ kind, opacity }),
      );
      expect(strokeLayers).toEqual(
        svgChrome(state, STROKE_PX, false).map(({ kind, opacity }) => ({ kind, opacity })),
      );
      // The geometry behind those layers is the shared pair, in every state that
      // draws chrome at all (a rest node draws none — see `gpuChrome`'s culling).
      expect(visibleChrome("strokes", state, chrome, PAINT_HALF_PX)).toEqual(
        state === "rest" ? { gapPx: 0, ringPx: 0 } : chromeBands(STROKE_PX),
      );

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

  test("the chrome uniform is laid out for the uniform address space", () => {
    // Every member naturally aligned, and the struct a multiple of its own
    // 16-byte alignment: the rule WGSL's uniform layout imposes and TypeGPU's
    // schema layout computes, so the shader's struct and the buffer agree.
    expect(sizeOf(Chrome) % 16).toBe(0);
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
