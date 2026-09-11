import * as v from "valibot";

import type { SceneValue } from "../eval/context";
import type { Expr } from "./expr";
import { isImageExtension, type ImageExtension } from "./import-image";

export const literalPatchSchema = v.object({
  file: v.string(),
  id: v.string(),
  target: v.literal("literal"),
  values: v.array(v.number()),
});

export type LiteralPatch = v.InferOutput<typeof literalPatchSchema>;

export function parseLiteralPatch(raw: SceneValue): LiteralPatch | string {
  const r = v.safeParse(literalPatchSchema, raw);
  if (r.success) return r.output;
  return r.issues.map((i) => i.message).join("; ");
}

const exprSchema: v.GenericSchema<Expr> = v.lazy(() =>
  v.union([
    v.object({ kind: v.literal("num"), value: v.number() }),
    v.object({ kind: v.literal("str"), value: v.string() }),
    v.object({ kind: v.literal("ref"), name: v.pipe(v.string(), v.minLength(1)) }),
    v.object({
      kind: v.literal("member"),
      object: exprSchema,
      field: v.pipe(v.string(), v.minLength(1)),
    }),
    v.object({ kind: v.literal("neg"), expr: exprSchema }),
    v.object({
      kind: v.literal("props"),
      props: v.record(v.string(), exprSchema),
    }),
    v.object({
      kind: v.literal("array"),
      items: v.array(exprSchema),
    }),
    v.object({
      kind: v.literal("call"),
      name: v.pipe(v.string(), v.minLength(1)),
      args: v.array(exprSchema),
    }),
  ]),
);

export const insertSchema = v.object({
  file: v.string(),
  dest: v.optional(v.string()),
  from: v.string(),
  bind: v.optional(v.string()),
  args: v.array(exprSchema),
  id: v.optional(v.string()),
  patchVertex: v.optional(
    v.object({
      id: v.pipe(v.string(), v.minLength(1)),
      index: v.pipe(v.number(), v.integer(), v.minValue(0)),
    }),
  ),
  tool: v.optional(
    v.object({
      module: v.pipe(v.string(), v.minLength(1)),
      prefix: v.pipe(v.string(), v.minLength(1)),
    }),
  ),
});

export type InsertBody = v.InferOutput<typeof insertSchema>;

export function parseInsert(raw: SceneValue): InsertBody | string {
  const r = v.safeParse(insertSchema, raw);
  if (r.success) return r.output;
  return r.issues.map((i) => i.message).join("; ");
}

export const paintPatchSchema = v.object({
  file: v.string(),
  id: v.pipe(v.string(), v.minLength(1)),
  style: exprSchema,
});

export type PaintPatchBody = v.InferOutput<typeof paintPatchSchema>;

export function parsePaintPatch(raw: SceneValue): PaintPatchBody | string {
  const r = v.safeParse(paintPatchSchema, raw);
  if (r.success) return r.output;
  return r.issues.map((i) => i.message).join("; ");
}

/**
 * The image patch: plain values at dotted leaves of the options object, flat so
 * the editor has one code path per prop.
 */
export const imagePatchSchema = v.object({
  file: v.string(),
  id: v.pipe(v.string(), v.minLength(1)),
  props: v.pipe(
    v.object({
      src: v.optional(v.pipe(v.string(), v.minLength(1))),
      "world.x": v.optional(v.number()),
      "world.y": v.optional(v.number()),
      "anchor.x": v.optional(v.number()),
      "anchor.y": v.optional(v.number()),
      "imageSize.width": v.optional(v.number()),
      "imageSize.height": v.optional(v.number()),
      "targetSize.width": v.optional(v.pipe(v.number(), v.minValue(0))),
      "targetSize.height": v.optional(v.pipe(v.number(), v.minValue(0))),
      rot: v.optional(v.union([v.literal(0), v.literal(90), v.literal(180), v.literal(270)])),
      flip: v.optional(v.union([v.literal(0), v.literal(1)])),
      "style.opacity": v.optional(v.pipe(v.number(), v.minValue(0), v.maxValue(1))),
      "style.saturation": v.optional(v.pipe(v.number(), v.minValue(0), v.maxValue(4))),
      "style.contrast": v.optional(v.pipe(v.number(), v.minValue(0), v.maxValue(4))),
    }),
    v.check(
      (p) => both(p["world.x"], p["world.y"]) && both(p["anchor.x"], p["anchor.y"]),
      "world and anchor each need both coordinates",
    ),
    v.check((p) => both(p["imageSize.width"], p["imageSize.height"]), "imageSize needs both sides"),
  ),
});

/** Both absent, or both present — never one of a pair. */
function both(a: unknown, b: unknown): boolean {
  return (a === undefined) === (b === undefined);
}

export type ImagePatchBody = v.InferOutput<typeof imagePatchSchema>;

export function parseImagePatch(raw: SceneValue): ImagePatchBody | string {
  const r = v.safeParse(imagePatchSchema, raw);
  if (!r.success) return r.issues.map((i) => i.message).join("; ");
  const { src, ...leaves } = r.output.props;
  if (src === undefined && Object.values(leaves).every((value) => value === undefined)) {
    return "props is empty";
  }
  return r.output;
}

/**
 * The upload's query string: a slug the client suggests (the server sanitises it
 * anyway) and the extension it derived from the decoded blob's format.
 */
export const imageImportSchema = v.object({
  slug: v.optional(v.string()),
  ext: v.pipe(
    v.string(),
    v.transform((s) => s.trim().toLowerCase().replace(/^\./, "")),
    v.check(isImageExtension, "unsupported image extension"),
  ),
});

export type ImageImportBody = { slug?: string; ext: ImageExtension };

export function parseImageImport(raw: SceneValue): ImageImportBody | string {
  const r = v.safeParse(imageImportSchema, raw);
  if (!r.success) return r.issues.map((i) => i.message).join("; ");
  // `v.check` rejects a bad value but does not narrow what the schema outputs.
  const ext = r.output.ext;
  if (!isImageExtension(ext)) return "unsupported image extension";
  return { ...(r.output.slug !== undefined ? { slug: r.output.slug } : {}), ext };
}

export const eraseSchema = v.object({
  file: v.string(),
  id: v.pipe(v.string(), v.minLength(1)),
});

export type EraseBody = v.InferOutput<typeof eraseSchema>;

export function parseErase(raw: SceneValue): EraseBody | string {
  const r = v.safeParse(eraseSchema, raw);
  if (r.success) return r.output;
  return r.issues.map((i) => i.message).join("; ");
}

export const frameEditSchema = v.object({
  file: v.string(),
  frame: v.object({
    x: v.number(),
    y: v.number(),
    width: v.pipe(v.number(), v.minValue(0)),
    height: v.pipe(v.number(), v.minValue(0)),
  }),
});

export type FrameEditBody = v.InferOutput<typeof frameEditSchema>;

export function parseFrameEdit(raw: SceneValue): FrameEditBody | string {
  const r = v.safeParse(frameEditSchema, raw);
  if (r.success) return r.output;
  return r.issues.map((i) => i.message).join("; ");
}

export const exposeSchema = v.object({
  file: v.string(),
  dest: v.pipe(v.string(), v.minLength(1)),
  bind: v.pipe(v.string(), v.minLength(1)),
});

export type ExposeBody = v.InferOutput<typeof exposeSchema>;

export function parseExpose(raw: SceneValue): ExposeBody | string {
  const r = v.safeParse(exposeSchema, raw);
  if (r.success) return r.output;
  return r.issues.map((i) => i.message).join("; ");
}

export const openSchema = v.object({
  file: v.pipe(v.string(), v.minLength(1)),
  line: v.pipe(v.number(), v.minValue(1)),
});

export type OpenBody = v.InferOutput<typeof openSchema>;

export function parseOpen(raw: SceneValue): OpenBody | string {
  const r = v.safeParse(openSchema, raw);
  if (r.success) return r.output;
  return r.issues.map((i) => i.message).join("; ");
}
