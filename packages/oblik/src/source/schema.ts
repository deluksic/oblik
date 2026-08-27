import * as v from "valibot";

import type { Expr } from "./expr";

export const literalPatchSchema = v.object({
  file: v.string(),
  id: v.string(),
  target: v.literal("literal"),
  values: v.array(v.number()),
});

export type LiteralPatch = v.InferOutput<typeof literalPatchSchema>;

export function parseLiteralPatch(raw: unknown): LiteralPatch | string {
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
});

export type InsertBody = v.InferOutput<typeof insertSchema>;

export function parseInsert(raw: unknown): InsertBody | string {
  const r = v.safeParse(insertSchema, raw);
  if (r.success) return r.output;
  return r.issues.map((i) => i.message).join("; ");
}

export const exposeSchema = v.object({
  file: v.string(),
  dest: v.pipe(v.string(), v.minLength(1)),
  bind: v.pipe(v.string(), v.minLength(1)),
});

export type ExposeBody = v.InferOutput<typeof exposeSchema>;

export function parseExpose(raw: unknown): ExposeBody | string {
  const r = v.safeParse(exposeSchema, raw);
  if (r.success) return r.output;
  return r.issues.map((i) => i.message).join("; ");
}
