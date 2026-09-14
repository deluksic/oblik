/**
 * The one text path: glyf-backed text for both the 2D pane and the 3D scene.
 *
 * A **layer** owns the glyph handle, the camera uniform and every text created
 * through it. A **font** owns a loaded `FontFace`. The two are separate because
 * glyph needs a font's rasters declared before a handle exists, while a layer is
 * what a renderer draws with — so a renderer builds a font once and hands it to
 * one or more layers.
 *
 * ## Where a label lives
 *
 * A label is **world-anchored**. Its anchor is the world point it hangs off, and
 * the camera is applied to that point on the GPU, in the vertex stage. The
 * screen-space part — the label box's own `dx`/`dy` — is a separate offset in
 * CSS px that the same stage adds *without* the camera.
 *
 * That split is the whole reason the CPU goes quiet when the camera moves:
 *
 * - A **pan or a zoom** writes one matrix ({@link TextLayer.writeProjection})
 *   and touches no label, no instance buffer and no glyph state.
 * - A label that **actually moves** writes twelve floats.
 * - A label whose **text or style** changes re-shapes, which is the only thing
 *   here that is expensive and the only thing that should be.
 *
 * The reconciliation itself — the part that decides what changed — lives in
 * `labels.ts`, free of the device, so it can be tested by counting writes. This
 * module is the wiring: glyph's engine on one side, that diff on the other.
 *
 * Invariants this module owns:
 * - Disposing a layer disposes its texts and its handle but never the caller's
 *   `TgpuRoot`; glyph treats that root as caller-owned.
 * - The engine (`glyph.init()`) is process-wide and idempotent; it is not a
 *   layer's to dispose.
 * - `glyph.shape()` is called at most once per draw, and only when a text was
 *   created, re-shaped or dropped. A camera move and a placement write are
 *   neither, so neither owes the engine a shape.
 */
import { glyph } from "@pmndrs/glyph";
import type { FontFaceFormat } from "@pmndrs/glyph";
import type { TypeGpuFontSelection } from "@pmndrs/glyph/typegpu";
import type { TgpuRenderPass, TgpuRoot } from "typegpu";

import { reconcileLabels, type LabelSpec, type LabelWriter, type LiveLabel } from "./labels";
import { defineOblikConfig, type OblikRoot } from "./msdf/config";
import type { OblikText } from "./msdf/text";
import type { Mat4 } from "./projection";

export type { KnockoutRing, LabelSpec, TextStyle } from "./labels";

/** Viewport in **logical** CSS pixels; the projection callback works in these. */
export type TextViewport = { readonly width: number; readonly height: number };

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

export type TextLayer = {
  /**
   * Reconcile a whole label set against the live one: create, restyle, move and
   * dispose as needed. Keys that survive are reused, so a pan or a zoom never
   * re-shapes text it has already shaped — and never touches it at all.
   */
  syncLabels(font: LoadedFont, labels: readonly LabelSpec[]): void;
  /**
   * Point the layer's camera at a **world→clip** matrix. Build it with
   * `paneProjection` for the 2D pane, or `perspective × view` for 3D.
   *
   * This is a 64-byte uniform write. No text is re-shaped, re-laid-out or even
   * read: the camera is applied to each label's anchor on the GPU.
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

const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

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
 * `format` must match how the asset was baked — including its **options**. Glyph
 * derives a raster's identity from the format's descriptor, so a bare `msdf`
 * means the *default* `emSize`/`pixelRange`, and asking for that against a
 * custom bake finds no artifact and quietly falls back to generating the raster
 * at runtime, which then fails for want of the source font bytes. Pass
 * `msdf({ emSize, pixelRange })` matching `pnpm bake:fonts`.
 */
export async function loadFont(
  src: string | URL,
  format: FontFaceFormat,
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

export function createTextLayer(options: TextLayerOptions): TextLayer {
  const { root, format } = options;

  const config = defineOblikConfig({
    root,
    format,
    ...(options.sampleCount === undefined ? {} : { sampleCount: options.sampleCount }),
    ...(options.depthStencil === undefined ? {} : { depthStencil: options.depthStencil }),
  });
  const handle = glyph.handle(options.name ?? "oblik-text", config) as unknown as OblikRoot & {
    dispose(): void;
  };

  let current: Mat4 = IDENTITY;
  let disposed = false;
  /**
   * A shape is owed to the engine whenever a text was created, re-shaped or
   * dropped — never for a camera move, and never for a placement write, because
   * those are uniforms the engine does not see.
   */
  let shapeOwed = false;
  const live = new Map<string, LiveLabel<OblikText>>();
  const wanted = new Set<string>();
  /** The font the live texts were built with; a new font re-shapes all of them. */
  let activeFont: LoadedFont | undefined;

  const assertLive = (what: string): void => {
    if (disposed) throw new Error(`TextLayer is disposed; cannot ${what}`);
  };

  const writer: LabelWriter<OblikText> = {
    create(label, style, placement) {
      if (activeFont === undefined) throw new Error("TextLayer has no font to shape with");
      return handle.createText({ font: activeFont.font, text: label.text, style }, placement);
    },
    reshape(text, label, style) {
      text.update({ text: label.text, style });
    },
    place(text, placement) {
      // `Placement` and the renderer's own placement record are the same shape;
      // the diff stays free of the device, so it declares its own.
      text.setPlacement(placement);
    },
    drop(text) {
      text.dispose();
    },
  };

  return {
    syncLabels(font, labels) {
      assertLive("sync labels");
      // A different font invalidates every shaped text: drop them so the diff
      // re-creates against the new face rather than reusing stale glyphs.
      if (activeFont !== undefined && activeFont !== font) {
        for (const entry of live.values()) entry.text.dispose();
        live.clear();
        shapeOwed = true;
      }
      activeFont = font;
      if (reconcileLabels(live, writer, labels, wanted)) shapeOwed = true;
    },
    writeProjection(m) {
      assertLive("write the projection");
      current = m;
      handle.setCamera(m as unknown as readonly number[]);
    },
    get projection() {
      return current;
    },
    draw(pass, viewport) {
      assertLive("draw");
      if (live.size === 0) return;
      // One shape per frame at most, and only when a text was added, re-shaped
      // or dropped. A pan or a label move owes the engine nothing.
      if (shapeOwed) {
        glyph.shape();
        shapeOwed = false;
      }
      handle.draw(pass, { width: viewport.width, height: viewport.height });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const entry of live.values()) entry.text.dispose();
      live.clear();
      // Destroys the handle's own resources; the caller's root stays alive.
      handle.dispose();
    },
  };
}
