import { formatNum } from "#source/patch";

/** Incomplete drafts like `-` / `.` stay invalid until they parse as a finite number. */
export function parseLiveNum(raw: string, opts?: { min?: number }): number | undefined {
  const t = raw.trim();
  if (t === "" || t === "-" || t === "+" || t === "." || t === "-." || t === "+.") return undefined;
  const n = Number(t);
  if (!Number.isFinite(n)) return undefined;
  if (opts?.min !== undefined && n < opts.min) return undefined;
  return n;
}

export function sameNum(a: number, b: number): boolean {
  return formatNum(a) === formatNum(b);
}
