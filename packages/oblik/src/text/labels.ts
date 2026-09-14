/**
 * The label vocabulary and the diff that reconciles a label set.
 *
 * This module is deliberately free of anything that needs a device: no glyph
 * import at runtime, no TypeGPU, no renderer. The one thing worth being able to
 * prove about the text path is a *behaviour* — that a camera move touches no
 * label, and that a label which did not move is not written — so the diff lives
 * where a plain unit test can drive it and count the writes.
 *
 * The rule the diff enforces:
 *
 * - a key that survives keeps its text, its glyphs and its buffers;
 * - a **placement** write happens only when that label's own anchor, box offset
 *   or ring changed;
 * - a **reshape** happens only when its text or style changed;
 * - everything else is left alone.
 *
 * Nothing here knows where the camera is. That is the point: the camera is not
 * part of a label, so it cannot appear in this diff.
 */
import type { TextStyle as GlyphTextStyle } from "@pmndrs/glyph";

/**
 * Glyph's text style, minus `decoration`: this renderer carries no decoration
 * runs, and narrowing here keeps that limitation visible at the call site
 * instead of hiding it behind a cast.
 */
export type TextStyle = Omit<GlyphTextStyle, "decoration">;

/**
 * **Knockout ring**: a band of background colour swept around the glyph, so the
 * label reads as cut out of whatever is behind it rather than laid on top.
 *
 * This costs no extra texts. Glyph's atlas is a signed distance field, so the
 * glyph and a band around it come from the same texel: the fragment paints the
 * field's band in `color`, and the vertex stage widens the quad by `gap` so the
 * band has geometry to land on. One text, one quad, one sample.
 */
export type KnockoutRing = {
  /** Ring thickness in screen px. */
  readonly gap: number;
  /** Ring colour — the background the glyph is knocked out of. Straight RGB. */
  readonly color: readonly [number, number, number];
};

/**
 * One node in a reconciled label set. `key` is the caller's stable identity (a
 * trace key in the 2D pane).
 *
 * `x`/`y` are a **world** anchor, not a screen position: the camera is applied
 * to them on the GPU. `dx`/`dy` are the screen-space part — the label box's own
 * offset in CSS px — which the vertex stage adds without the camera.
 */
export type LabelSpec = {
  readonly key: string;
  readonly text: string;
  /** World anchor. The camera is applied to this, on the GPU. */
  readonly x: number;
  readonly y: number;
  /** Screen-space offset in CSS px (y down) from the anchor to the label box. */
  readonly dx?: number | undefined;
  readonly dy?: number | undefined;
  readonly style?: TextStyle | undefined;
  /** A knockout ring around this label, or none. */
  readonly knockout?: KnockoutRing | undefined;
};

/** The ring a label asks for, resolved to the placement record's shape. */
export type RingRecord = {
  readonly gap: number;
  readonly enabled: boolean;
  readonly color: readonly [number, number, number];
};

const NO_RING: RingRecord = { gap: 0, enabled: false, color: [0, 0, 0] };

/** Where a label hangs, in the terms the shader's uniforms take. */
export type Placement = {
  readonly anchor: readonly [number, number];
  readonly offset: readonly [number, number];
  readonly ring: RingRecord;
};

/**
 * What was last written for one label. Placement is kept as plain numbers so a
 * caller that legitimately rebuilds its label objects every frame still
 * compares by value — which is what makes the diff a diff and not a write.
 */
export type Written = {
  text: string;
  style: TextStyle;
  x: number;
  y: number;
  dx: number;
  dy: number;
  gap: number;
  ring: boolean;
  r: number;
  g: number;
  b: number;
};

/** A live label and what has been written for it. */
export type LiveLabel<Text> = { text: Text; written: Written };

/** What reconciliation is allowed to do to a text. */
export type LabelWriter<Text> = {
  create(label: LabelSpec, style: TextStyle, placement: Placement): Text;
  /** Re-shape: the text or the style changed. */
  reshape(text: Text, label: LabelSpec, style: TextStyle): void;
  /** Write the placement uniforms. No shaping, no layout, no allocation. */
  place(text: Text, placement: Placement): void;
  drop(text: Text): void;
};

/** The placement record a label's ring implies, or an explicit "no ring". */
function ringOf(knockout: KnockoutRing | undefined): RingRecord {
  if (knockout === undefined) return NO_RING;
  return { gap: Math.max(0, knockout.gap), enabled: true, color: knockout.color };
}

/** The `Written` record a fresh label starts with. */
function writtenFor(label: LabelSpec, style: TextStyle, ring: RingRecord): Written {
  return {
    text: label.text,
    style,
    x: label.x,
    y: label.y,
    dx: label.dx ?? 0,
    dy: label.dy ?? 0,
    gap: ring.gap,
    ring: ring.enabled,
    r: ring.color[0],
    g: ring.color[1],
    b: ring.color[2],
  };
}

const DEFAULT_STYLE: TextStyle = { fontSize: 12 };

/**
 * Reconcile `labels` against `live`, writing only what changed.
 *
 * Returns `true` when a text was created, re-shaped or dropped — i.e. when the
 * engine owes a shape. A camera move produces no call to this function at all;
 * a call where nothing moved returns `false` and writes nothing.
 *
 * `wanted` is a caller-owned scratch set so a steady-state sync allocates
 * nothing.
 */
export function reconcileLabels<Text>(
  live: Map<string, LiveLabel<Text>>,
  writer: LabelWriter<Text>,
  labels: readonly LabelSpec[],
  wanted: Set<string>,
  defaultStyle: TextStyle = DEFAULT_STYLE,
): boolean {
  let shapeOwed = false;
  wanted.clear();
  for (const label of labels) {
    wanted.add(label.key);
    const style = label.style ?? defaultStyle;
    const dx = label.dx ?? 0;
    const dy = label.dy ?? 0;
    const ring = ringOf(label.knockout);

    const existing = live.get(label.key);
    if (existing === undefined) {
      const placement: Placement = { anchor: [label.x, label.y], offset: [dx, dy], ring };
      const text = writer.create(label, style, placement);
      live.set(label.key, { text, written: writtenFor(label, style, ring) });
      shapeOwed = true;
      continue;
    }

    const was = existing.written;
    if (was.text !== label.text || was.style !== style) {
      writer.reshape(existing.text, label, style);
      was.text = label.text;
      was.style = style;
      shapeOwed = true;
    }
    // A camera move must never reach here. Only this label's own anchor, box
    // offset or ring changing is a reason to write it.
    if (
      was.x !== label.x ||
      was.y !== label.y ||
      was.dx !== dx ||
      was.dy !== dy ||
      was.gap !== ring.gap ||
      was.ring !== ring.enabled ||
      was.r !== ring.color[0] ||
      was.g !== ring.color[1] ||
      was.b !== ring.color[2]
    ) {
      writer.place(existing.text, { anchor: [label.x, label.y], offset: [dx, dy], ring });
      was.x = label.x;
      was.y = label.y;
      was.dx = dx;
      was.dy = dy;
      was.gap = ring.gap;
      was.ring = ring.enabled;
      was.r = ring.color[0];
      was.g = ring.color[1];
      was.b = ring.color[2];
    }
  }
  for (const [key, entry] of live) {
    if (wanted.has(key)) continue;
    live.delete(key);
    writer.drop(entry.text);
    shapeOwed = true;
  }
  return shapeOwed;
}
