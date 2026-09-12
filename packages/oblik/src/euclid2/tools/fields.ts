import type { Field, ToolSession } from "./types";

/** Parse a numeric field's text. Empty, "-", "." and "-." are pending, not errors. */
export function parseNum(raw: string | undefined): number | undefined {
  const t = raw?.trim() ?? "";
  if (t === "" || t === "-" || t === "." || t === "-.") return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

export function numberField<S extends ToolSession>(
  id: string,
  placeholder: string,
  get: (session: S) => string,
  set: (session: S, raw: string) => S,
): Field<S> {
  return { id, kind: "length", placeholder, open: () => true, get, set };
}
