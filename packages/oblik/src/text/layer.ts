/**
 * The one text path: glyf-backed text for both the 2D pane and the 3D scene.
 *
 * A **layer** owns the projection uniform, the glyph handle and every text
 * created through it. A **font** owns a loaded `FontFace`. The two are separate
 * because glyph needs a font's rasters declared before a handle exists, while a
 * layer is what a renderer draws with — so a renderer builds a font once and
 * hands it to one or more layers.
 *
 * Why this is *one* path and not two: a 2D label and a 3D label differ only in
 * the matrix written into {@link TextLayer.writeProjection}. The 2D pane writes
 * a screen-space orthographic matrix; a 3D scene writes `viewProj` applied to
 * the label's world anchor. Everything else — the shaders, the shaper, layout,
 * measuring, batching, the draw call — is shared, because glyph's
 * `transformPosition` callback is the only place the projection appears.
 *
 * Depth is the one deliberate difference: a layer is created with or without a
 * `depthStencil` because that is a property of the pass it draws into, not of
 * the text. Passing it lets opaque geometry occlude text while transparent
 * glyph quads keep depth-writes off (see {@link TextLayerOptions.depthStencil}).
 *
 * Invariants this module owns:
 * - `glyph.shape()` is called once per frame by {@link TextLayer.draw}, after
 *   pending `set`/`style`/`layout` edits — callers never call it themselves.
 * - Disposing a layer disposes its texts and its handle but never the caller's
 *   `TgpuRoot`; glyph treats that root as caller-owned.
 * - The engine (`glyph.init()`) is process-wide and idempotent; it is not a
 *   layer's to dispose.
 */
import { glyph } from "@pmndrs/glyph";
import type { RasterFormatMetadata, TextStyle as GlyphTextStyle } from "@pmndrs/glyph";
import { defineTypeGpuConfig } from "@pmndrs/glyph/typegpu";
import type { TypeGpuFontSelection, TypeGpuText } from "@pmndrs/glyph/typegpu";
import { d, type TgpuRenderPass, type TgpuRoot } from "typegpu";

import { orthoPixels, pixelTransform, type Mat4, type PixelTransform } from "./projection";

/**
 * Glyph's text style, minus `decoration`: the TypeGPU adapter does not carry
 * decoration runs yet, and its option type says so with `decoration?: never`.
 * Narrowing here keeps that limitation visible at the call site instead of
 * hiding it behind a cast.
 */
export type TextStyle = Omit<GlyphTextStyle, "decoration">;

/** Viewport in **logical** CSS pixels; the projection callback works in these. */
export type TextViewport = { readonly width: number; readonly height: number };

/** A world point a label hangs off. `z` is the depth used for occlusion. */
export type LabelAnchor = { readonly x: number; readonly y: number; readonly z?: number };

export type TextLayerOptions = {
  /** Caller-owned root. The layer never destroys it. */
  readonly root: TgpuRoot;
  /**
   * Color attachment format of the passes {@link TextLayer.draw} records into.
   * Must match the painter's target.
   */
  readonly format: GPUTextureFormat;
  /**
   * Sample count of that target. The painter uses 4× MSAA, so text must too or
   * pipeline creation fails — this is not a preference.
   * @default 1
   */
  readonly sampleCount?: 1 | 4 | undefined;
  /**
   * Depth state for the pass, or omitted for a pass with no depth attachment.
   * `depthWriteEnabled: false` is the useful setting: writing depth for the
   * transparent parts of a glyph quad would occlude the world behind it, while
   * `less-equal` still lets nearer geometry occlude the text.
   */
  readonly depthStencil?: GPUDepthStencilState | undefined;
  /** Stable name for the glyph handle, for debugging. */
  readonly name?: string | undefined;
};

/**
 * **Knockout ring**: a band of background colour swept around the glyph, so the
 * label reads as cut out of whatever is behind it rather than laid on top.
 *
 * This is field-free — no shadow, no offset. The ring is the glyph's own shape
 * displaced in every direction by `gap`, drawn in `color` underneath the glyph.
 * The glyph's draw covers the middle, which is what turns the union of shifted
 * shapes into a ring.
 *
 * Glyph's MSDF pipeline already computes a band that would do this in one quad,
 * but the TypeGPU adapter does not wire it: the band's width comes from the span
 * extent, which never widens, so the band falls outside the glyph's quad and is
 * clipped. A displaced copy has a quad of its own that reaches where it is put —
 * see {@link knockoutStack}.
 */
export type KnockoutRing = {
  /** Ring thickness in screen px. */
  readonly gap: number;
  /** Ring colour — the background the glyph is knocked out of. */
  readonly color: string;
};

/**
 * One node in a reconciled label set. `key` is the caller's stable identity
 * (a trace key in the 2D pane); the layer diffs on it so a camera move only
 * writes uniforms instead of rebuilding glyph texts.
 */
export type LabelSpec = {
  readonly key: string;
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly style?: TextStyle | undefined;
  /** A knockout ring around this label, or none. */
  readonly knockout?: KnockoutRing | undefined;
};

export type TextLayer = {
  /**
   * Reconcile a whole label set against the live one: create, reposition,
   * restyle and dispose as needed. Keys that survive are reused, so a pan or a
   * zoom never re-shapes text it has already shaped.
   *
   * Styling is per-label, which is what keeps distinct styles (muted, hover,
   * selected) expressible while every label in an equal style still shares a
   * glyph material.
   */
  syncLabels(font: LoadedFont, labels: readonly LabelSpec[]): void;
  /**
   * Point the layer at a matrix. `pixels` is the projection of one viewport
   * pixel into clip space; build it with {@link orthoPixels} for the 2D pane or
   * {@link perspective} × view for 3D.
   *
   * A label's pixel-space anchor then comes from {@link anchorFor}, which
   * collapses a world anchor through the same matrix.
   */
  writeProjection(m: Mat4): void;
  /** The matrix most recently written. */
  readonly projection: Mat4;
  /** Record every accepted text into a caller-owned pass. Shapes first. */
  draw(pass: TgpuRenderPass | GPURenderPassEncoder, viewport: TextViewport): void;
  dispose(): void;
};

/** A loaded font, owned by whoever created it. */
export type LoadedFont = {
  /** The glyph font selection accepted by `createText`. */
  readonly font: TypeGpuFontSelection;
  readonly family: string;
  dispose(): void;
};

const DEFAULT_STYLE: TextStyle = { fontSize: 12 };

/** Directions sampled around the gap ring. See {@link ringData}. */
const KNOCKOUT_RING = 16;

/**
 * Cached geometry for one ring appearance: the compass offsets and the styles
 * they share.
 *
 * Both depend only on `(gap, color, style)` — never on where a label sits — so
 * they are computed once and reused across every label and every frame. A pan or
 * a drag must not allocate a ring per label, and with this it does not.
 *
 * The single `{0,0}` offset is the glyph's own spot: the glyph is painted after
 * the ring, so it covers that copy exactly, turning the union of shifted shapes
 * into a ring rather than a blob.
 *
 * Sampling is a fidelity knob, not a correctness one — a sparse ring shows a
 * faintly scalloped outer edge, never a hole.
 */
/**
 * Ring geometry by appearance. Keyed on **values**, not on the style object:
 * callers legitimately build a fresh style per label per sync, so an
 * object-keyed cache would never hit. The key space is bounded by the styles a
 * caller actually animates (a handful of colours x a few sizes), not by label
 * count, so this cannot grow with the scene.
 */
const ringCache = new Map<string, { offsets: { x: number; y: number }[]; band: TextStyle }>();

/** Identity of a ring's appearance: the style it sits on plus the ring colour. */
function ringKey(gap: number, ring: KnockoutRing, style: TextStyle): string {
  return `${gap}|${ring.color}|${style.fontSize ?? 0}|${String(style.color ?? "")}|${style.opacity ?? 1}`;
}

function ringData(
  gap: number,
  ring: KnockoutRing,
  style: TextStyle,
): { offsets: { x: number; y: number }[]; band: TextStyle } {
  const key = ringKey(gap, ring, style);
  const hit = ringCache.get(key);
  if (hit !== undefined) return hit;

  const radius = Math.max(0.5, gap);
  const offsets: { x: number; y: number }[] = [{ x: 0, y: 0 }];
  for (let i = 0; i < KNOCKOUT_RING; i += 1) {
    const a = (i / KNOCKOUT_RING) * Math.PI * 2;
    offsets.push({ x: Math.cos(a) * radius, y: Math.sin(a) * radius });
  }
  const made = { offsets, band: { ...style, color: ring.color } as TextStyle };
  ringCache.set(key, made);
  return made;
}

/**
 * The texts one label needs, in **paint order**: the ring, then the glyph.
 *
 * Both are normal draws of the string at their own `position`, and that position
 * is a **world anchor** — the camera lives in the projection uniform and is
 * applied per-vertex, so moving the camera never rewrites a label.
 *
 * The appends rather than returns, so the caller can reuse one stack array and
 * this stays allocation-free on the hot path. A glyph's quad is exactly
 * glyph-sized, so ink only appears inside it; a displaced copy has a quad of its
 * own that reaches wherever it is put, which is why the ring needs no widening.
 */
export function appendKnockoutStack(
  out: { role: "gap" | "glyph"; x: number; y: number; style: TextStyle }[],
  x: number,
  y: number,
  style: TextStyle,
  ring: KnockoutRing,
): void {
  const gap = Math.max(0, ring.gap);
  if (gap > 0) {
    const { offsets, band } = ringData(gap, ring, style);
    for (const at of offsets) out.push({ role: "gap", x: x + at.x, y: y + at.y, style: band });
  }
  // The glyph on top: it covers the middle of the swept union, leaving the band.
  out.push({ role: "glyph", x, y, style });
}

/** Once per process; `glyph.init()` is idempotent but the promise is not cheap. */
let engine: Promise<void> | undefined;

/**
 * Boot the shaping engine. Safe to call from every pane; the shaper WASM is
 * ~1.2 MB and is loaded once for the app's lifetime.
 */
export function ensureEngine(): Promise<void> {
  return (engine ??= glyph.init().catch((err: unknown) => {
    // A failed init must not poison every later caller: clear so a retry can run.
    engine = undefined;
    throw err;
  }));
}

/**
 * Load a font and declare the raster format its baked artifact carries.
 *
 * `format` is required and must match how the asset was baked (`--msdf` is the
 * default and the sensible one for scalable labels). Loading without declaring
 * it resolves but fails later at `createText` with "format is not loaded", so
 * the declaration is not optional here.
 */
export async function loadFont(
  src: string | URL,
  format: RasterFormatMetadata,
): Promise<LoadedFont> {
  await ensureEngine();
  const face = glyph.fontFace(src, { format });
  await face.load();
  return {
    font: face as unknown as TypeGpuFontSelection,
    family: String(face.family),
    dispose: () => face.dispose(),
  };
}

/**
 * A screen-space offset expressed as a world distance.
 *
 * Returning magnitudes, not a signed world vector: a screen offset is y-down and
 * a world anchor is y-up, so the sign is the caller's to apply. Doing it here
 * would hide a flip that is easy to get backwards (and was).
 *
 * The conversion itself is needed because the shader adds its text offset and
 * *then* projects, which makes that offset a screen-space translation carried by
 * the matrix. A label's anchor is world-space, so a screen-pixel offset has to
 * be divided by the camera scale — otherwise the label sits a fixed world
 * distance from its point and slides as you zoom.
 */
export function screenOffsetToWorld(
  offset: { x: number; y: number },
  scale: number,
): { x: number; y: number } {
  const s = Math.max(1e-6, scale);
  return { x: offset.x / s, y: offset.y / s };
}

/**
 * The 2D pane's projection: world units to clip space through a camera.
 *
 * World units and viewport pixels coincide at the identity camera, and the
 * shader's `clip = orthoPixels(size) × (world + offset)` composes to exactly the
 * world→screen→NDC mapping the HTML overlay used. So a label's offset is its
 * **world** anchor and the camera never has to touch a label.
 */
export function cameraProjection(
  cam: { x: number; y: number; scale: number },
  viewport: TextViewport,
): Mat4 {
  const w = Math.max(1, viewport.width);
  const h = Math.max(1, viewport.height);
  // The shader yields clip = M·(world + offset), and clip→screen is
  // sx = (cx+1)/2·w, sy = (1-cy)/2·h. Solving for the pane's own mapping —
  // sx = w/2 + (x-cam.x)·scale, sy = h/2 - (y-cam.y)·scale — gives this. Note
  // the y translation is negative: the y row already carries the flip, so cam.y
  // must be added in clip space, not subtracted.
  return [
    (2 * cam.scale) / w,
    0,
    0,
    0,
    0,
    (2 * cam.scale) / h,
    0,
    0,
    0,
    0,
    1,
    0,
    (-2 * cam.scale * cam.x) / w,
    (-2 * cam.scale * cam.y) / h,
    0,
    1,
  ];
}

/**
 * Where a world anchor lands, in the y-down pixels glyph consumes.
 *
 * Returns `undefined` when the anchor is behind the camera, where the
 * perspective divide is meaningless — callers should skip that label.
 */
export function anchorFor(
  m: Mat4,
  world: LabelAnchor,
  viewport: TextViewport,
): { position: readonly [number, number]; pixels: PixelTransform } | undefined {
  const pixels = pixelTransform(m, world);
  if (pixels.origin.w <= 1e-6) return undefined;
  return {
    position: [
      ((pixels.origin.x / pixels.origin.w + 1) / 2) * viewport.width,
      ((1 - pixels.origin.y / pixels.origin.w) / 2) * viewport.height,
    ],
    pixels,
  };
}

export function createTextLayer(options: TextLayerOptions): TextLayer {
  const { root, format } = options;
  const sampleCount = options.sampleCount ?? 1;

  // The projection is a caller-owned uniform captured by the shader callback, so
  // a camera move is a 64-byte write and never a rebuild of the pipelines.
  const projection = root.createUniform(d.mat4x4f);
  let current: Mat4 = orthoPixels(1, 1);
  projection.write(current as unknown as number[]);

  const config = defineTypeGpuConfig({
    root,
    format,
    sampleCount,
    ...(options.depthStencil === undefined ? {} : { depthStencil: options.depthStencil }),
    transformPosition: (position, _viewport) => {
      "use gpu";
      // `position` arrives in top-left, y-down logical pixels after the shader
      // added this text's offset — exactly the space the caller's matrix must
      // map. Pass z through and keep w for the perspective divide.
      const p = projection.$ * d.vec4f(position.x, position.y, position.z, 1);
      return d.vec4f(p.x, p.y, p.z, p.w);
    },
  });

  const handle = glyph.handle(options.name ?? "oblik-text", config);
  const texts = new Set<TypeGpuText<TypeGpuFontSelection>>();
  /** Live label stacks by caller key, so `syncLabels` reuses instead of rebuilds. */
  const synced = new Map<string, TypeGpuText<TypeGpuFontSelection>[]>();
  /**
   * What was last written to each text. `update()` is skipped when a text's
   * text/position/style identity is unchanged, which is what keeps a static
   * frame and a camera pan from doing any per-label work at all — and `update`
   * is not free: glyph spreads its retained options and rebuilds them on every
   * call, so an unconditional update allocates several objects per text.
   */
  const written = new WeakMap<
    TypeGpuText<TypeGpuFontSelection>,
    { text: string; x: number; y: number; style: TextStyle }
  >();
  /** One stack array, reused for every label: the ring is cached, so this is
   * the only per-label scratch, and it does not grow after the first sync. */
  const stack: { role: "gap" | "glyph"; x: number; y: number; style: TextStyle }[] = [];
  /** Membership scratch, reused for the same reason. */
  const wanted = new Set<string>();
  let disposed = false;

  const assertLive = (what: string): void => {
    if (disposed) throw new Error(`TextLayer is disposed; cannot ${what}`);
  };

  /** Drop one text from the live set, exactly once. Its key's group is the
   * caller's to remove — `syncLabels` owns group membership. */
  const release = (text: TypeGpuText<TypeGpuFontSelection>): void => {
    if (!texts.delete(text)) return;
    text.dispose();
  };

  return {
    syncLabels(font, labels) {
      assertLive("sync labels");
      wanted.clear();
      for (const label of labels) {
        wanted.add(label.key);
        const style = label.style ?? DEFAULT_STYLE;

        stack.length = 0;
        if (label.knockout === undefined) {
          stack.push({ role: "glyph", x: label.x, y: label.y, style });
        } else {
          appendKnockoutStack(stack, label.x, label.y, style, label.knockout);
        }

        let group = synced.get(label.key);
        if (group === undefined || group.length !== stack.length) {
          if (group !== undefined) for (const text of group) release(text);
          group = [];
          synced.set(label.key, group);
        }
        for (let i = 0; i < stack.length; i += 1) {
          const layer = stack[i]!;
          const existing = group[i];
          if (existing === undefined) {
            const created = handle.createText({
              font: font.font,
              text: label.text,
              style: layer.style,
              position: [layer.x, layer.y],
            });
            group.push(created);
            texts.add(created);
            written.set(created, { text: label.text, x: layer.x, y: layer.y, style: layer.style });
            continue;
          }
          const was = written.get(existing);
          if (
            was !== undefined &&
            was.text === label.text &&
            was.x === layer.x &&
            was.y === layer.y &&
            was.style === layer.style
          ) {
            continue;
          }
          existing.update({
            text: label.text,
            position: [layer.x, layer.y],
            style: layer.style,
          });
          written.set(existing, { text: label.text, x: layer.x, y: layer.y, style: layer.style });
        }
      }
      for (const [key, group] of synced) {
        if (wanted.has(key)) continue;
        synced.delete(key);
        for (const text of group) release(text);
      }
    },
    writeProjection(m) {
      assertLive("write the projection");
      current = m;
      projection.write(m as unknown as number[]);
    },
    get projection() {
      return current;
    },
    draw(pass, viewport) {
      assertLive("draw");
      if (texts.size === 0) return;
      // One shape per frame covers every edit since the last draw; glyph batches
      // the texts into this draw call.
      glyph.shape();
      handle.draw(pass, { width: viewport.width, height: viewport.height });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const text of texts) text.dispose();
      texts.clear();
      synced.clear();
      // Destroys the handle's own resources; the caller's root stays alive.
      handle.dispose();
      projection.buffer.destroy();
    },
  };
}
