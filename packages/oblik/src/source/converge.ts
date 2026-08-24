import type { Annotation } from "./analyze";

export function convergeDraft(
  draft: Map<string, number[]>,
  annotations: Map<string, Annotation> | Record<string, Annotation>,
): Map<string, number[]> {
  const anno = annotations instanceof Map ? annotations : new Map(Object.entries(annotations));
  const next = new Map(draft);
  for (const [id, vals] of draft) {
    const lit = anno.get(id)?.literals;
    if (!lit || lit.length !== vals.length) continue;
    const same = lit.every((n, i) => Math.abs(n - (vals[i] ?? NaN)) < 0.005);
    if (same) next.delete(id);
  }
  return next;
}
