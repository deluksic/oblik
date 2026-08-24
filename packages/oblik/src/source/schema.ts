import * as v from "valibot";

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
